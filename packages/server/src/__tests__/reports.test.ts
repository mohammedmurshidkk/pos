import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
// Type-only: erased at runtime, so it cannot open the DB before POS_DB is set.
import type { Range } from '../services/reports.js'

process.env.POS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'pos-rep-')), 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const { addItems, createOrder, getOrder, sendToKitchen } = await import('../services/orders.js')
const { applyDiscount, settle } = await import('../services/billing.js')
const { voidLine } = await import('../services/voids.js')
const R = await import('../services/reports.js')
const { eq } = await import('drizzle-orm')

const s = schema
let ids: Record<string, string> = {}
const ALL: Range = { from: new Date(0), to: new Date('2100-01-01'), label: 'all' }

beforeAll(() => {
  migrateDb()
  seed()
  const item = (n: string) => db.select().from(s.items).where(eq(s.items.name, n)).get()!.id
  const emp = (n: string) => db.select().from(s.employees).where(eq(s.employees.name, n)).get()!.id
  const mode = (n: string) => db.select().from(s.paymentModes).where(eq(s.paymentModes.name, n)).get()!.id
  ids = {
    alfaham: item('Periperi Alfaham'), noodles: item('Chicken Noodles'), juice: item('Apple Juice'),
    rahul: emp('Rahul'), anees: emp('Anees'), fatima: emp('Fatima'),
    counter: db.select().from(s.counters).get()!.id,
    cash: mode('Cash'), sbi: mode('SBI Card'),
  }
})

function sell(
  lines: { itemId: string; qty: number }[],
  opts: { waiter?: string; mode?: string; type?: 'dine_in' | 'takeaway' | 'car' | 'delivery' } = {},
) {
  const o = createOrder({ type: opts.type ?? 'takeaway', createdBy: ids.rahul! })!
  addItems(o.id, lines, ids.rahul!)
  sendToKitchen(o.id, opts.waiter ?? ids.rahul!)
  return o.id
}

function pay(orderId: string, modeId = ids.cash!) {
  const total = getOrder(orderId)!.total
  settle(orderId, {
    payments: [{ paymentModeId: modeId, amount: total, refNo: '4411' }],
    employeeId: ids.fatima!, counterId: ids.counter!,
  })
  return orderId
}

describe('scope', () => {
  it('counts only settled orders — open and billed ones are not revenue yet', () => {
    const before = R.salesSummary(ALL)
    sell([{ itemId: ids.alfaham!, qty: 1 }]) // left open
    expect(R.salesSummary(ALL).total).toBe(before.total)

    pay(sell([{ itemId: ids.alfaham!, qty: 1 }]))
    expect(R.salesSummary(ALL).total).toBe(before.total + 8500)
  })

  it('excludes voided lines from item figures', () => {
    const id = sell([{ itemId: ids.noodles!, qty: 2 }, { itemId: ids.juice!, qty: 1 }])
    const noodleLine = getOrder(id)!.lines.find((l) => l.nameSnapshot.includes('Noodles'))!
    voidLine(id, noodleLine.id, 'Customer changed mind', ids.fatima!)
    pay(id)

    const noodles = R.itemWise(ALL).find((r) => r.name === 'Chicken Noodles')
    expect(noodles).toBeUndefined() // the only noodles sold were voided
    expect(R.itemWise(ALL).find((r) => r.name === 'Apple Juice')!.qty).toBe(1)
  })
})

describe('reconciliation', () => {
  it('gross - discounts + service equals total, and net + tax equals total', () => {
    const id = sell([{ itemId: ids.alfaham!, qty: 2 }])
    applyDiscount(id, { type: 'percent', value: 10, reason: 'Staff Meal', employeeId: ids.fatima! })
    pay(id)

    const sum = R.salesSummary(ALL)
    expect(sum.grossSales - sum.discounts + sum.serviceCharge).toBe(sum.total)
    expect(sum.net + sum.tax).toBe(sum.total)
  })

  it('item, category and order-type totals all reconcile to the same gross', () => {
    const gross = R.salesSummary(ALL).grossSales
    expect(R.itemWise(ALL).reduce((a, r) => a + r.gross, 0)).toBe(gross)
    expect(R.categoryWise(ALL).reduce((a, r) => a + r.gross, 0)).toBe(gross)
    // Order types carry the discounted total, so they sum to total, not gross.
    expect(R.orderTypeWise(ALL).reduce((a, r) => a + r.total, 0)).toBe(R.salesSummary(ALL).total)
  })

  it('payments sum to the sales total', () => {
    expect(R.paymentModeWise(ALL).reduce((a, m) => a + m.total, 0)).toBe(R.salesSummary(ALL).total)
  })
})

describe('breakdowns', () => {
  it('credits the order owner, not the cashier who settled it', () => {
    pay(sell([{ itemId: ids.alfaham!, qty: 1 }], { waiter: ids.anees! }))
    const rows = R.employeeWise(ALL)
    expect(rows.some((r) => r.name === 'Anees')).toBe(true)
    expect(rows.some((r) => r.name === 'Fatima')).toBe(false)
  })

  it('separates merchant accounts', () => {
    pay(sell([{ itemId: ids.alfaham!, qty: 1 }]), ids.sbi!)
    const modes = R.paymentModeWise(ALL)
    expect(modes.find((m) => m.name === 'SBI Card')!.merchant).toBe('SBI')
    expect(modes.find((m) => m.name === 'Cash')!.type).toBe('cash')
  })

  it('lists discounts and voids with reason and employee', () => {
    const r = R.discountsAndVoids(ALL)
    expect(r.totals.discountCount).toBeGreaterThan(0)
    expect(r.discounts[0]!.by).toBe('Fatima')
    expect(r.discounts[0]!.reason).toBe('Staff Meal')
    expect(r.voids[0]!.reason).toBe('Customer changed mind')
    expect(r.voids[0]!.by).toBe('Fatima')
  })

  it('reports voids even when the order never settled', () => {
    // A walked-out table is exactly the case an owner wants to see.
    const id = sell([{ itemId: ids.juice!, qty: 1 }])
    const line = getOrder(id)!.lines[0]!
    const before = R.discountsAndVoids(ALL).totals.voidCount
    voidLine(id, line.id, 'Walked out', ids.fatima!)
    expect(R.discountsAndVoids(ALL).totals.voidCount).toBe(before + 1)
  })

  it('reports the tax summary with a contiguous invoice range', () => {
    const t = R.taxSummary(ALL)
    expect(t.taxName).toBe('VAT')
    expect(t.taxRatePct).toBe(5)
    expect(t.net + t.tax).toBe(t.total)
    expect(t.invoiceRange.to! - t.invoiceRange.from!).toBe(t.invoices - 1)
  })
})

describe('date ranges', () => {
  it('rolls the business day over at the configured hour', () => {
    // A restaurant closing at 02:00 wants those sales on the previous day.
    db.update(s.settings).set({ businessDayStartHour: 5 }).where(eq(s.settings.id, 'singleton')).run()
    const today = R.resolveRange({ preset: 'today' })
    expect(today.from.getHours()).toBe(5)

    const now = new Date()
    if (now.getHours() < 5) {
      expect(today.from.getDate()).toBe(new Date(now.getTime() - 86400000).getDate())
    }
    db.update(s.settings).set({ businessDayStartHour: 0 }).where(eq(s.settings.id, 'singleton')).run()
  })

  it('yesterday ends exactly where today begins', () => {
    const today = R.resolveRange({ preset: 'today' })
    const yesterday = R.resolveRange({ preset: 'yesterday' })
    expect(yesterday.to.getTime()).toBe(today.from.getTime())
  })

  it('rejects a backwards or incomplete custom range', () => {
    expect(() => R.resolveRange({ preset: 'custom', from: '2026-09-10', to: '2026-09-01' })).toThrow(/before the start/i)
    expect(() => R.resolveRange({ preset: 'custom', from: '2026-09-10' })).toThrow(/both from and to/i)
    expect(() => R.resolveRange({ preset: 'custom', from: 'nonsense', to: 'nonsense' })).toThrow(/invalid/i)
  })

  it('excludes sales outside the window', () => {
    const past: Range = { from: new Date('2020-01-01'), to: new Date('2020-12-31'), label: 'past' }
    expect(R.salesSummary(past).orders).toBe(0)
    expect(R.itemWise(past)).toEqual([])
    expect(R.paymentModeWise(past)).toEqual([])
  })
})

describe('csv export', () => {
  it('emits money as decimals a spreadsheet can sum', () => {
    const csv = R.toCsv([{ name: 'Periperi Alfaham', qty: 3, gross: 25500 }], ['gross'], 2)
    expect(csv).toBe('name,qty,gross\nPeriperi Alfaham,3,255.00')
  })

  it('quotes fields containing commas or quotes', () => {
    const csv = R.toCsv([{ reason: 'Staff meal, half price', note: 'said "ok"' }])
    expect(csv).toContain('"Staff meal, half price"')
    expect(csv).toContain('"said ""ok"""')
  })

  it('returns empty output for no rows rather than a stray header', () => {
    expect(R.toCsv([])).toBe('')
  })

  it('serialises nested values instead of writing [object Object]', () => {
    const csv = R.toCsv([{ label: 'x', range: { from: 1042, to: 1045 } }])
    expect(csv).not.toContain('[object Object]')
    expect(csv).toContain('{""from"":1042,""to"":1045}')
  })
})
