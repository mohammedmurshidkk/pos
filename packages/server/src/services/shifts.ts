import { and, count, eq, gte, inArray, isNotNull, isNull, lte, sum } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { audit } from '../audit.js'
import { backupTo, db, raw } from '../db.js'
import { conflict, notFound } from '../errors.js'
import { printQueue } from '../queue.js'
import type { ZReportPayload } from '../templates.js'
import { requireCounter } from './counters.js'
import { requireEmployee } from './employees.js'
import { assertLicensed, licenceStatus } from './licence.js'

const s = schema

/** The open shift on a counter, if any. Only one at a time. */
export function openShiftIdFor(counterId: string): string | null {
  const row = db
    .select({ id: s.shifts.id })
    .from(s.shifts)
    .where(and(eq(s.shifts.counterId, counterId), isNull(s.shifts.closedAt)))
    .get()
  return row?.id ?? null
}

/** Orders still waiting for money — seated, sent or billed. */
function unsettledOrderCount(): number {
  const row = db.select({ n: count() }).from(s.orders)
    .where(inArray(s.orders.status, ['open', 'billed'])).get()
  return row?.n ?? 0
}

/**
 * Whether a shift may be opened now.
 *
 * Settling needs an open shift, and an expired licence must never strand a
 * seated table. So expiry (or no licence at all) blocks a new shift only when there is nothing left to
 * settle; while unsettled orders remain, a shift can be opened to take their
 * money. New orders stay blocked either way.
 */
export function canOpenShift(): boolean {
  const { state } = licenceStatus()
  return (state !== 'expired' && state !== 'unlicensed') || unsettledOrderCount() > 0
}

export function openShift(input: { counterId: string; employeeId: string; openingFloat: number }) {
  requireEmployee(input.employeeId)
  requireCounter(input.counterId)
  if (!canOpenShift()) assertLicensed('open shift')
  if (openShiftIdFor(input.counterId)) {
    throw conflict('A shift is already open on this counter. Close it first.')
  }
  const counter = db.select().from(s.counters).where(eq(s.counters.id, input.counterId)).get()
  if (!counter) throw notFound('counter')
  const emp = db.select().from(s.employees).where(eq(s.employees.id, input.employeeId)).get()
  if (!emp) throw notFound('employee')

  const id = newId()
  db.insert(s.shifts).values({
    id,
    employeeId: input.employeeId,
    counterId: input.counterId,
    openedAt: new Date(),
    openingFloat: input.openingFloat,
  }).run()

  audit(input.employeeId, 'shift.open', 'shift', id, { counterId: input.counterId, openingFloat: input.openingFloat })
  return db.select().from(s.shifts).where(eq(s.shifts.id, id)).get()!
}

export interface ZReport {
  shiftId: string
  counterName: string
  cashierName: string
  openedAt: Date
  closedAt: Date | null
  paymentModes: { name: string; type: string; count: number; total: number }[]
  grandTotal: number
  cash: {
    openingFloat: number
    cashSales: number
    drawerExpenses: number
    expected: number
    counted: number | null
    variance: number | null
  }
  orderTypes: { type: string; count: number; total: number }[]
  waiters: { name: string; orders: number; total: number }[]
  discounts: { count: number; total: number }
  voids: { count: number; total: number }
  savedWithoutKot: number
  vatCollected: number
  invoiceRange: { from: number | null; to: number | null; count: number }
}

/**
 * Build the Z-report. Callable before closing so the cashier can preview it,
 * and again at close for the printed copy.
 */
export function zReport(shiftId: string, countedCash?: number | null): ZReport {
  const shift = db.select().from(s.shifts).where(eq(s.shifts.id, shiftId)).get()
  if (!shift) throw notFound('shift')

  const counter = db.select().from(s.counters).where(eq(s.counters.id, shift.counterId)).get()!
  const cashier = db.select().from(s.employees).where(eq(s.employees.id, shift.employeeId)).get()!
  const until = shift.closedAt ?? new Date()

  const paymentModes = db
    .select({
      name: s.paymentModes.name,
      type: s.paymentModes.type,
      countsInCash: s.paymentModes.countsInCashClosing,
      count: count(s.payments.id),
      total: sum(s.payments.amount),
    })
    .from(s.payments)
    .innerJoin(s.paymentModes, eq(s.payments.paymentModeId, s.paymentModes.id))
    .where(eq(s.payments.shiftId, shiftId))
    .groupBy(s.paymentModes.id)
    .all()
    .map((r) => ({ ...r, total: Number(r.total ?? 0) }))

  const grandTotal = paymentModes.reduce((a, m) => a + m.total, 0)
  const cashSales = paymentModes.filter((m) => m.countsInCash).reduce((a, m) => a + m.total, 0)

  // Expenses paid out of the drawer must reduce expected cash, or the variance
  // is wrong every single night.
  const drawerExpenses = Number(
    db.select({ total: sum(s.expenses.amount) })
      .from(s.expenses)
      .where(and(eq(s.expenses.shiftId, shiftId), eq(s.expenses.paidFromDrawer, true)))
      .get()?.total ?? 0,
  )

  const expected = shift.openingFloat + cashSales - drawerExpenses
  const counted = countedCash ?? shift.countedCash ?? null

  const settled = db
    .select()
    .from(s.orders)
    .where(and(eq(s.orders.shiftId, shiftId), eq(s.orders.status, 'settled')))
    .all()

  const byType = new Map<string, { count: number; total: number }>()
  for (const o of settled) {
    const e = byType.get(o.type) ?? { count: 0, total: 0 }
    e.count += 1
    e.total += o.total
    byType.set(o.type, e)
  }

  const byWaiter = new Map<string, { orders: number; total: number }>()
  for (const o of settled) {
    // Credit the order owner, not whoever keyed it — otherwise every order the
    // cashier entered on a waiter's behalf credits the cashier.
    const key = o.waiterId ?? 'counter'
    const e = byWaiter.get(key) ?? { orders: 0, total: 0 }
    e.orders += 1
    e.total += o.total
    byWaiter.set(key, e)
  }
  const waiters = [...byWaiter]
    .map(([id, v]) => ({
      name: id === 'counter' ? 'Counter' : db.select().from(s.employees).where(eq(s.employees.id, id)).get()?.name ?? 'Unknown',
      ...v,
    }))
    .sort((a, b) => b.total - a.total)

  const discounted = settled.filter((o) => o.discountAmount > 0)
  const vatCollected = settled.reduce((a, o) => a + o.taxAmount, 0)

  const voidRows = db
    .select({ qty: s.orderItems.qty, price: s.orderItems.unitPriceSnapshot })
    .from(s.orderItems)
    .where(and(
      eq(s.orderItems.status, 'void'),
      isNotNull(s.orderItems.voidedAt),
      gte(s.orderItems.voidedAt, shift.openedAt),
      lte(s.orderItems.voidedAt, until),
    ))
    .all()

  const savedWithoutKot = db
    .select({ n: count(s.orderItems.id) })
    .from(s.orderItems)
    .where(and(
      eq(s.orderItems.kotSuppressed, true),
      gte(s.orderItems.createdAt, shift.openedAt),
      lte(s.orderItems.createdAt, until),
    ))
    .get()?.n ?? 0

  const invoiceNos = settled.map((o) => o.invoiceNo).filter((n): n is number => n != null).sort((a, b) => a - b)

  return {
    shiftId,
    counterName: counter.name,
    cashierName: cashier.name,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    paymentModes: paymentModes.map(({ name, type, count, total }) => ({ name, type, count, total })),
    grandTotal,
    cash: {
      openingFloat: shift.openingFloat,
      cashSales,
      drawerExpenses,
      expected,
      counted,
      variance: counted == null ? null : counted - expected,
    },
    orderTypes: [...byType].map(([type, v]) => ({ type, ...v })),
    waiters,
    discounts: { count: discounted.length, total: discounted.reduce((a, o) => a + o.discountAmount, 0) },
    voids: { count: voidRows.length, total: voidRows.reduce((a, r) => a + r.qty * r.price, 0) },
    savedWithoutKot,
    vatCollected,
    invoiceRange: { from: invoiceNos[0] ?? null, to: invoiceNos.at(-1) ?? null, count: invoiceNos.length },
  }
}

/**
 * Close the shift: freeze the report, print it, and take a backup.
 *
 * The backup is the point. No cloud means one hard drive holds the whole
 * business, and shift close is the natural moment to snapshot it.
 */
export function closeShift(shiftId: string, countedCash: number, employeeId: string, backupDir?: string) {
  requireEmployee(employeeId)
  const shift = db.select().from(s.shifts).where(eq(s.shifts.id, shiftId)).get()
  if (!shift) throw notFound('shift')
  if (shift.closedAt) throw conflict('This shift is already closed.')

  const openOrders = db
    .select({ n: count(s.orders.id) })
    .from(s.orders)
    .where(and(eq(s.orders.counterId, shift.counterId), eq(s.orders.status, 'billed')))
    .get()?.n ?? 0
  if (openOrders > 0) {
    throw conflict(`${openOrders} order(s) are billed but not settled. Settle or cancel them before closing.`)
  }

  const report = zReport(shiftId, countedCash)

  raw.transaction(() => {
    db.update(s.shifts).set({
      closedAt: new Date(),
      countedCash,
      expectedCash: report.cash.expected,
      variance: report.cash.variance,
    }).where(eq(s.shifts.id, shiftId)).run()
  })()

  const counter = db.select().from(s.counters).where(eq(s.counters.id, shift.counterId)).get()!
  const cfg = db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()!
  const payload: ZReportPayload = {
    businessName: cfg.businessName,
    currencyDisplay: cfg.currencyDisplay,
    currencyDecimals: cfg.currencyDecimals,
    taxName: cfg.taxName,
    invoicePrefix: cfg.invoicePrefix,
    report: { ...report, closedAt: new Date() },
  }
  db.insert(s.printJobs).values({
    id: newId(), printerId: counter.printerId, kind: 'report',
    payloadJson: JSON.stringify(payload), refId: shiftId,
  }).run()
  printQueue.kick(counter.printerId)

  let backupPath: string | null = null
  if (backupDir) {
    const nameStamp = new Date().toISOString().replace(/[:.]/g, '-')
    backupPath = `${backupDir}/pos-${nameStamp}.db`
    backupTo(backupPath)
    db.update(s.settings).set({ lastBackupAt: new Date() }).where(eq(s.settings.id, 'singleton')).run()
  }

  audit(employeeId, 'shift.close', 'shift', shiftId, {
    counted: countedCash, expected: report.cash.expected, variance: report.cash.variance, backupPath,
  })
  return { report: { ...report, counted: countedCash }, backupPath }
}
