import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(path.join(tmpdir(), 'pos-dayclose-'))
process.env.POS_DB = path.join(dir, 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const { addItems, createOrder, sendToKitchen } = await import('../services/orders.js')
const { settle } = await import('../services/billing.js')
const { closeShift, openShift, zReport } = await import('../services/shifts.js')
const { createExpense } = await import('../services/expenses.js')
const { closeDay, dayReport, dayReportPreview, listDayCloses, reprintDayClose } = await import('../services/day-close.js')
const { renderDayReport, renderJob } = await import('../templates.js')
const { eq } = await import('drizzle-orm')

const s = schema
let ids: Record<string, string> = {}

beforeAll(() => {
  migrateDb()
  seed()
  const emp = (n: string) => db.select().from(s.employees).where(eq(s.employees.name, n)).get()!.id
  const mode = (n: string) => db.select().from(s.paymentModes).where(eq(s.paymentModes.name, n)).get()!.id
  ids = {
    alfaham: db.select().from(s.items).where(eq(s.items.name, 'Periperi Alfaham')).get()!.id,
    rahul: emp('Rahul'), fatima: emp('Fatima'), anees: emp('Anees'),
    counter: db.select().from(s.counters).get()!.id,
    cash: mode('Cash'), sbi: mode('SBI Card'),
    gas: db.select().from(s.expenseCategories).where(eq(s.expenseCategories.name, 'Gas')).get()!.id,
  }
})

/** Sell one 85.00 alfaham. */
function sell(paymentModeId: string, cashier: string) {
  const o = createOrder({ type: 'takeaway', createdBy: ids.rahul! })!
  addItems(o.id, [{ itemId: ids.alfaham!, qty: 1 }], ids.rahul!)
  sendToKitchen(o.id, ids.rahul!)
  // Card modes need an approval number.
  const refNo = paymentModeId === ids.sbi ? 'TEST-REF' : undefined
  settle(o.id, { payments: [{ paymentModeId, amount: 8500, refNo }], employeeId: cashier, counterId: ids.counter! })
}

/** One whole shift: float, sales, a payout, then close with the drawer `off` by that much. */
function runShift(cashier: string, float: number, sales: string[], payout: number, off = 0) {
  const shift = openShift({ counterId: ids.counter!, employeeId: cashier, openingFloat: float })
  for (const m of sales) sell(m, cashier)
  if (payout) createExpense({ expenseCategoryId: ids.gas!, amount: payout, paidBy: cashier, counterId: ids.counter!, note: 'Cylinder' })
  const expected = zReport(shift.id).cash.expected
  closeShift(shift.id, expected + off, cashier, dir)
  return shift.id
}

describe('day close', () => {
  it('refuses while a shift is open, and with nothing to close', () => {
    const shift = openShift({ counterId: ids.counter!, employeeId: ids.fatima!, openingFloat: 0 })
    expect(dayReportPreview(ids.counter!).shiftOpen).toBe(true)
    expect(() => closeDay(ids.counter!, ids.fatima!)).toThrow(/current shift/i)
    closeShift(shift.id, 0, ids.fatima!, dir)
    // That empty shift is now pending; close it away so the next test starts clean.
    closeDay(ids.counter!, ids.fatima!)
    expect(() => closeDay(ids.counter!, ids.fatima!)).toThrow(/no closed shifts/i)
  })

  it('puts every shift since the last day close on one report, with counter totals', () => {
    const a = runShift(ids.fatima!, 50000, [ids.cash!, ids.cash!, ids.sbi!], 2000)
    const b = runShift(ids.anees!, 30000, [ids.cash!, ids.sbi!], 0, -500)
    const c = runShift(ids.fatima!, 20000, [ids.cash!], 1000, 250)

    const preview = dayReportPreview(ids.counter!)
    expect(preview.shiftOpen).toBe(false)
    expect(preview.report.shifts.map((z) => z.shiftId)).toEqual([a, b, c])

    const day = closeDay(ids.counter!, ids.fatima!)
    expect(day.dayCloseId).toBeTruthy()
    expect(day.shifts).toHaveLength(3)
    expect(day.shifts.map((z) => z.cashierName)).toEqual(['Fatima', 'Anees', 'Fatima'])

    const t = day.totals
    expect(t.grandTotal).toBe(6 * 8500)
    expect(t.paymentModes.find((m) => m.name === 'Cash')).toMatchObject({ count: 4, total: 4 * 8500 })
    expect(t.paymentModes.find((m) => m.name === 'SBI Card')).toMatchObject({ count: 2, total: 2 * 8500 })
    expect(t.cash.cashSales).toBe(4 * 8500)
    expect(t.cash.drawerExpenses).toBe(3000)
    expect(t.cash.openingFloats).toBe(50000 + 30000 + 20000)
    expect(t.cash.expected).toBe(t.cash.openingFloats + t.cash.cashSales - t.cash.drawerExpenses)
    expect(t.cash.counted - t.cash.expected).toBe(t.cash.variance)
    expect(t.cash.variance).toBe(-250)
    expect(t.expenses).toMatchObject({ drawer: 3000, other: 0, total: 3000 })
    expect(t.expenses.byCategory).toEqual([{ category: 'Gas', count: 2, total: 3000 }])
    expect(t.invoiceRange.count).toBe(6)
    expect(t.invoiceRange.to! - t.invoiceRange.from!).toBe(5)
    expect(t.vatCollected).toBe(day.shifts.reduce((a, z) => a + z.vatCollected, 0))

    // Each shift keeps its own Z-report figures.
    expect(day.shifts[1]!.cash.variance).toBe(-500)
    expect(day.shifts[0]!.cash.openingFloat).toBe(50000)

    for (const id of [a, b, c]) {
      expect(db.select().from(s.shifts).where(eq(s.shifts.id, id)).get()!.dayCloseId).toBe(day.dayCloseId)
    }
    const jobs = db.select().from(s.printJobs).where(eq(s.printJobs.refId, day.dayCloseId!)).all()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.kind).toBe('report')
    expect(JSON.parse(jobs[0]!.payloadJson).day.shifts).toHaveLength(3)
    expect(db.select().from(s.auditLog).where(eq(s.auditLog.entityId, day.dayCloseId!)).all().map((l) => l.action))
      .toContain('day.close')
  })

  it('starts the next day empty, and keeps the past one for reprint', () => {
    expect(dayReportPreview(ids.counter!).report.shifts).toHaveLength(0)
    const list = listDayCloses(ids.counter!)
    expect(list[0]!.shiftCount).toBe(3)
    expect(list[0]!.grandTotal).toBe(6 * 8500)

    const again = dayReport(list[0]!.id)
    expect(again.totals.grandTotal).toBe(6 * 8500)
    reprintDayClose(list[0]!.id, ids.fatima!)
    expect(db.select().from(s.printJobs).where(eq(s.printJobs.refId, list[0]!.id)).all()).toHaveLength(2)

    const next = runShift(ids.anees!, 10000, [ids.cash!], 0)
    expect(dayReportPreview(ids.counter!).report.shifts.map((z) => z.shiftId)).toEqual([next])
  })

  it('prints a section per shift and the counter totals', () => {
    const job = db.select().from(s.printJobs).where(eq(s.printJobs.refId, listDayCloses(ids.counter!)[0]!.id)).get()!
    const payload = JSON.parse(job.payloadJson)
    const text = renderDayReport(payload, 80).toString('latin1')
    expect(text).toContain('DAY CLOSE')
    expect(text).toContain('SHIFT 1 - Fatima')
    expect(text).toContain('SHIFT 2 - Anees')
    expect(text).toContain('SHIFT 3 - Fatima')
    expect(text).toContain('COUNTER TOTALS')
    expect(text).toContain('TOTAL EXPENSES')
    // The queue renders it through the same 'report' kind as a Z-report.
    expect(renderJob('report', payload, 80).toString('latin1')).toContain('COUNTER TOTALS')
    // 58mm paper: no line wider than 32 columns.
    const narrow = renderDayReport(payload, 58).toString('latin1')
    for (const line of narrow.split('\n')) expect(line.replace(/[\x1b\x1d]./g, '').replace(/[\x00-\x1f]/g, '').length).toBeLessThanOrEqual(32)
  })
})
