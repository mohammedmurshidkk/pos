import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(path.join(tmpdir(), 'pos-history-'))
process.env.POS_DB = path.join(dir, 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const { addItems, createOrder, listClosedOrders, sendToKitchen, submitOrder } = await import('../services/orders.js')
const { printBill, settle } = await import('../services/billing.js')
const { voidOrder } = await import('../services/voids.js')
const { openShift } = await import('../services/shifts.js')
const { createExpense, listExpenses } = await import('../services/expenses.js')
const { resolveRange } = await import('../services/reports.js')
const { eq } = await import('drizzle-orm')

const s = schema
let ids: Record<string, string> = {}

beforeAll(() => {
  migrateDb()
  seed()
  const emp = (n: string) => db.select().from(s.employees).where(eq(s.employees.name, n)).get()!.id
  ids = {
    alfaham: db.select().from(s.items).where(eq(s.items.name, 'Periperi Alfaham')).get()!.id,
    rahul: emp('Rahul'), fatima: emp('Fatima'),
    counter: db.select().from(s.counters).get()!.id,
    cash: db.select().from(s.paymentModes).where(eq(s.paymentModes.name, 'Cash')).get()!.id,
    gas: db.select().from(s.expenseCategories).where(eq(s.expenseCategories.name, 'Gas')).get()!.id,
  }
  openShift({ counterId: ids.counter!, employeeId: ids.fatima!, openingFloat: 50000 })
})

describe('closed bills', () => {
  it('lists settled orders with lines and payments, and leaves open ones out', () => {
    const paid = createOrder({ type: 'takeaway', createdBy: ids.rahul! })!
    addItems(paid.id, [{ itemId: ids.alfaham!, qty: 1 }], ids.rahul!)
    sendToKitchen(paid.id, ids.rahul!)
    const total = db.select().from(s.orders).where(eq(s.orders.id, paid.id)).get()!.total
    settle(paid.id, { payments: [{ paymentModeId: ids.cash!, amount: total }], employeeId: ids.fatima!, counterId: ids.counter! })

    const open = createOrder({ type: 'takeaway', createdBy: ids.rahul! })!

    const rows = listClosedOrders(resolveRange({ preset: 'today' }))
    const found = rows.find((o) => o.id === paid.id)!
    expect(found.status).toBe('settled')
    expect(found.lines).toHaveLength(1)
    expect(found.payments).toEqual([{ amount: total, refNo: null, mode: 'Cash' }])
    expect(rows.some((o) => o.id === open.id)).toBe(false)

    // Yesterday holds nothing: it was settled today.
    expect(listClosedOrders(resolveRange({ preset: 'yesterday' })).some((o) => o.id === paid.id)).toBe(false)
  })

  it('reprints a settled bill without allocating a new invoice number', () => {
    const settled = listClosedOrders(resolveRange({ preset: 'today' })).find((o) => o.status === 'settled')!
    const r = printBill(settled.id, ids.fatima!, ids.counter!)
    expect(r.invoiceNo).toBe(settled.invoiceNo)
    expect(r.reprintCount).toBe(settled.reprintCount + 1)
  })

  it('includes cancelled orders so they can be looked up too', () => {
    const o = createOrder({ type: 'takeaway', createdBy: ids.rahul! })!
    addItems(o.id, [{ itemId: ids.alfaham!, qty: 1 }], ids.rahul!)
    voidOrder(o.id, 'Walked out', ids.fatima!)
    const row = listClosedOrders(resolveRange({ preset: 'today' })).find((x) => x.id === o.id)
    expect(row?.status).toBe('void')
  })
})

describe('order taken at the counter', () => {
  it('creates, adds and sends in one call, and a retry does not duplicate it', () => {
    const body = {
      batchRef: 'counter-test-1', type: 'takeaway' as const, ticketLabel: 'Walk-in',
      lines: [{ itemId: ids.alfaham!, qty: 2 }], employeeId: ids.fatima!,
    }
    const first = submitOrder(body)
    const again = submitOrder(body)
    expect(first.duplicate).toBe(false)
    expect(again.duplicate).toBe(true)
    expect(again.order?.id).toBe(first.order?.id)
    expect(first.order?.createdBy).toBe(ids.fatima)
    expect(first.order?.lines.every((l) => l.status === 'sent')).toBe(true)
  })
})

describe('expenses list', () => {
  it('filters by range and category', () => {
    createExpense({ expenseCategoryId: ids.gas!, amount: 18000, note: 'Cylinder', paidBy: ids.fatima!, counterId: ids.counter! })
    const today = resolveRange({ preset: 'today' })
    const all = listExpenses(today)
    expect(all.some((e) => e.note === 'Cylinder' && e.paidFromDrawer && e.categoryId === ids.gas)).toBe(true)

    const other = db.select().from(s.expenseCategories).all().find((c) => c.id !== ids.gas)!
    expect(listExpenses({ ...today, categoryId: other.id }).some((e) => e.note === 'Cylinder')).toBe(false)
    expect(listExpenses(resolveRange({ preset: 'yesterday' })).some((e) => e.note === 'Cylinder')).toBe(false)
  })
})
