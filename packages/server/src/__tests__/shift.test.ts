import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(path.join(tmpdir(), 'pos-shift-'))
process.env.POS_DB = path.join(dir, 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const { addItems, createOrder, getOrder, sendToKitchen } = await import('../services/orders.js')
const { applyDiscount, settle } = await import('../services/billing.js')
const { voidLine } = await import('../services/voids.js')
const { closeShift, openShift, openShiftIdFor, zReport } = await import('../services/shifts.js')
const { createExpense } = await import('../services/expenses.js')
const { eq } = await import('drizzle-orm')

const s = schema
let ids: Record<string, string> = {}

beforeAll(() => {
  migrateDb()
  seed()
  const item = (n: string) => db.select().from(s.items).where(eq(s.items.name, n)).get()!.id
  const emp = (n: string) => db.select().from(s.employees).where(eq(s.employees.name, n)).get()!.id
  const mode = (n: string) => db.select().from(s.paymentModes).where(eq(s.paymentModes.name, n)).get()!.id
  ids = {
    alfaham: item('Periperi Alfaham'),
    noodles: item('Chicken Noodles'),
    rahul: emp('Rahul'), anees: emp('Anees'), fatima: emp('Fatima'),
    counter: db.select().from(s.counters).get()!.id,
    cash: mode('Cash'), sbi: mode('SBI Card'),
    gas: db.select().from(s.expenseCategories).where(eq(s.expenseCategories.name, 'Gas')).get()!.id,
  }
})

/** Sell one 85.00 alfaham and settle it however the test wants. */
function sell(
  payments: { paymentModeId: string; amount: number; refNo?: string }[],
  opts: { waiter?: string; qty?: number; type?: 'dine_in' | 'takeaway' } = {},
) {
  const o = createOrder({ type: opts.type ?? 'takeaway', createdBy: ids.rahul! })!
  addItems(o.id, [{ itemId: ids.alfaham!, qty: opts.qty ?? 1 }], ids.rahul!)
  sendToKitchen(o.id, opts.waiter ?? ids.rahul!)
  const r = settle(o.id, { payments, employeeId: ids.fatima!, counterId: ids.counter! })
  return { id: o.id, ...r }
}

describe('shift lifecycle', () => {
  it('opens one shift per counter and refuses a second', () => {
    const shift = openShift({ counterId: ids.counter!, employeeId: ids.fatima!, openingFloat: 50000 })
    expect(shift.openingFloat).toBe(50000)
    expect(openShiftIdFor(ids.counter!)).toBe(shift.id)
    expect(() => openShift({ counterId: ids.counter!, employeeId: ids.fatima!, openingFloat: 1000 }))
      .toThrow(/already open/i)
  })

  it('attaches payments to the open shift without the client tracking it', () => {
    const shiftId = openShiftIdFor(ids.counter!)!
    sell([{ paymentModeId: ids.cash!, amount: 8500 }])
    const rows = db.select().from(s.payments).where(eq(s.payments.shiftId, shiftId)).all()
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('cash reconciliation', () => {
  it('records only what settles the bill, not the cash tendered', () => {
    // 100.00 handed over for an 85.00 bill: the drawer gains 85.00, not 100.00.
    const r = sell([{ paymentModeId: ids.cash!, amount: 10000 }])
    expect(r.settled).toBe(true)
    expect(r.changeDue).toBe(1500)

    const paid = db.select().from(s.payments).where(eq(s.payments.orderId, r.id)).all()
    expect(paid).toHaveLength(1)
    expect(paid[0]!.amount).toBe(8500) // not 10000 — change is not drawer cash
  })

  it('counts only cash modes toward the drawer', () => {
    const shiftId = openShiftIdFor(ids.counter!)!
    const before = zReport(shiftId).cash.cashSales
    sell([{ paymentModeId: ids.sbi!, amount: 8500, refNo: '4411' }])
    expect(zReport(shiftId).cash.cashSales).toBe(before) // card doesn't touch the drawer
  })

  it('subtracts drawer expenses from expected cash', () => {
    const shiftId = openShiftIdFor(ids.counter!)!
    const before = zReport(shiftId).cash
    createExpense({
      expenseCategoryId: ids.gas!, amount: 18000, note: 'Gas cylinder',
      paidBy: ids.fatima!, counterId: ids.counter!,
    })
    const after = zReport(shiftId).cash
    expect(after.drawerExpenses).toBe(before.drawerExpenses + 18000)
    expect(after.expected).toBe(before.expected - 18000)
  })

  it('reconciles float + cash sales - expenses, and reports the variance', () => {
    const shiftId = openShiftIdFor(ids.counter!)!
    const z = zReport(shiftId)
    expect(z.cash.expected).toBe(z.cash.openingFloat + z.cash.cashSales - z.cash.drawerExpenses)

    const short = zReport(shiftId, z.cash.expected - 1000)
    expect(short.cash.variance).toBe(-1000)
    const over = zReport(shiftId, z.cash.expected + 250)
    expect(over.cash.variance).toBe(250)
  })
})

describe('z-report figures', () => {
  it('splits sales by payment mode with transaction counts', () => {
    const z = zReport(openShiftIdFor(ids.counter!)!)
    const cash = z.paymentModes.find((m) => m.name === 'Cash')!
    const sbi = z.paymentModes.find((m) => m.name === 'SBI Card')!
    expect(cash.count).toBeGreaterThan(0)
    expect(sbi.count).toBeGreaterThan(0)
    expect(z.grandTotal).toBe(z.paymentModes.reduce((a, m) => a + m.total, 0))
  })

  it('credits the order owner, not the cashier who keyed it', () => {
    const shiftId = openShiftIdFor(ids.counter!)!
    sell([{ paymentModeId: ids.cash!, amount: 8500 }], { waiter: ids.anees! })
    const z = zReport(shiftId)
    // Fatima settled every order in this shift but owns none of them.
    expect(z.waiters.some((w) => w.name === 'Anees')).toBe(true)
    expect(z.waiters.some((w) => w.name === 'Fatima')).toBe(false)
  })

  it('reports discounts, voids, saved-without-KOT and VAT', () => {
    const shiftId = openShiftIdFor(ids.counter!)!

    const o = createOrder({ type: 'takeaway', createdBy: ids.rahul! })!
    addItems(o.id, [{ itemId: ids.alfaham!, qty: 1 }, { itemId: ids.noodles!, qty: 2 }], ids.rahul!)
    sendToKitchen(o.id, ids.rahul!)
    const noodleLine = getOrder(o.id)!.lines.find((l) => l.nameSnapshot.includes('Noodles'))!
    voidLine(o.id, noodleLine.id, 'Customer changed mind', ids.fatima!)
    applyDiscount(o.id, { type: 'percent', value: 10, reason: 'Staff Meal', employeeId: ids.fatima! })
    settle(o.id, {
      payments: [{ paymentModeId: ids.cash!, amount: getOrder(o.id)!.total }],
      employeeId: ids.fatima!, counterId: ids.counter!,
    })

    const noKot = createOrder({ type: 'takeaway', createdBy: ids.fatima! })!
    addItems(noKot.id, [{ itemId: ids.alfaham!, qty: 1 }], ids.fatima!)
    sendToKitchen(noKot.id, ids.fatima!, true)
    settle(noKot.id, {
      payments: [{ paymentModeId: ids.cash!, amount: getOrder(noKot.id)!.total }],
      employeeId: ids.fatima!, counterId: ids.counter!,
    })

    const z = zReport(shiftId)
    expect(z.discounts.count).toBeGreaterThan(0)
    // Discount applies to the post-void subtotal: only the 85.00 alfaham remains.
    expect(z.discounts.total).toBe(850)
    expect(z.voids.count).toBe(1)
    expect(z.voids.total).toBe(7600) // 2 x 38.00
    expect(z.savedWithoutKot).toBe(1)
    expect(z.vatCollected).toBeGreaterThan(0)
  })

  it('reports a contiguous invoice range', () => {
    const z = zReport(openShiftIdFor(ids.counter!)!)
    expect(z.invoiceRange.from).not.toBeNull()
    expect(z.invoiceRange.to! - z.invoiceRange.from!).toBe(z.invoiceRange.count - 1)
  })
})

describe('closing', () => {
  it('refuses to close while an order is billed but unsettled', () => {
    const shiftId = openShiftIdFor(ids.counter!)!
    const o = createOrder({ type: 'takeaway', createdBy: ids.rahul! })!
    addItems(o.id, [{ itemId: ids.alfaham!, qty: 1 }], ids.rahul!)
    db.update(s.orders).set({ status: 'billed', counterId: ids.counter! }).where(eq(s.orders.id, o.id)).run()

    expect(() => closeShift(shiftId, 0, ids.fatima!)).toThrow(/not settled/i)
    db.update(s.orders).set({ status: 'void' }).where(eq(s.orders.id, o.id)).run()
  })

  it('refuses to close while an order is still open, even one from a tablet with no counter', () => {
    const shiftId = openShiftIdFor(ids.counter!)!
    const o = createOrder({ type: 'takeaway', createdBy: ids.rahul! })!
    addItems(o.id, [{ itemId: ids.alfaham!, qty: 1 }], ids.rahul!)
    sendToKitchen(o.id, ids.rahul!)

    expect(() => closeShift(shiftId, 0, ids.fatima!)).toThrow(new RegExp(`#${getOrder(o.id)!.orderNo}`))
    db.update(s.orders).set({ status: 'void' }).where(eq(s.orders.id, o.id)).run()
  })

  it('does not count an open order with nothing on it', () => {
    const shiftId = openShiftIdFor(ids.counter!)!
    const o = createOrder({ type: 'takeaway', createdBy: ids.rahul! })!
    expect(() => zReport(shiftId)).not.toThrow()
    // Left open on purpose: the next test closes the shift around it.
    expect(getOrder(o.id)!.status).toBe('open')
  })

  it('freezes the numbers, queues the report and writes a backup', () => {
    const shiftId = openShiftIdFor(ids.counter!)!
    const expected = zReport(shiftId).cash.expected

    const { report, backupPath } = closeShift(shiftId, expected - 1000, ids.fatima!, dir)
    expect(report.cash.variance).toBe(-1000)
    expect(backupPath).toContain('.db')
    expect(readdirSync(dir).some((f) => f.startsWith('pos-'))).toBe(true)

    const stored = db.select().from(s.shifts).where(eq(s.shifts.id, shiftId)).get()!
    expect(stored.closedAt).not.toBeNull()
    expect(stored.expectedCash).toBe(expected)
    expect(stored.variance).toBe(-1000)

    const jobs = db.select().from(s.printJobs).where(eq(s.printJobs.refId, shiftId)).all()
    expect(jobs.some((j) => j.kind === 'report')).toBe(true)
  })

  it('refuses to close twice, and frees the counter for a new shift', () => {
    const closed = db.select().from(s.shifts).all().find((x) => x.closedAt != null)!
    expect(() => closeShift(closed.id, 0, ids.fatima!)).toThrow(/already closed/i)
    expect(openShiftIdFor(ids.counter!)).toBeNull()
    expect(openShift({ counterId: ids.counter!, employeeId: ids.rahul!, openingFloat: 20000 })).toBeTruthy()
  })
})
