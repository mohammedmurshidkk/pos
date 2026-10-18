import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db, raw } from '../db.js'
import { conflict, notFound } from '../errors.js'
import { printQueue } from '../queue.js'
import type { DayReportPayload } from '../templates.js'
import { requireCounter } from './counters.js'
import { requireEmployee } from './employees.js'
import { openShiftIdFor, zReport, type ZReport } from './shifts.js'

const s = schema

/**
 * Counter day close.
 *
 * A 24-hour shop runs several shifts a day, each with its own opening float,
 * sales, expenses and Z-report. The day close comes after the last of them and
 * puts every shift closed on the counter since the previous day close on one
 * report: each shift, then the counter's totals. Shift length is the shop's
 * business, so the day is "the shifts not yet in a day close", never a clock
 * window.
 */
export interface DayReport {
  /** Null while previewing. */
  dayCloseId: string | null
  counterName: string
  closedBy: string | null
  closedAt: Date | null
  from: Date | null
  to: Date | null
  shifts: ZReport[]
  totals: {
    paymentModes: { name: string; type: string; count: number; total: number }[]
    grandTotal: number
    /**
     * Every shift counts its own drawer against its own float, so the day's
     * cash is the sum of the shifts: floats + cash sales - drawer expenses =
     * expected, and counted - expected = the shifts' over/short added up.
     */
    cash: {
      openingFloats: number
      cashSales: number
      drawerExpenses: number
      expected: number
      counted: number
      variance: number
    }
    expenses: {
      drawer: number
      /** Recorded during a shift but not paid from the drawer. */
      other: number
      total: number
      byCategory: { category: string; count: number; total: number }[]
    }
    orderTypes: { type: string; count: number; total: number }[]
    waiters: { name: string; orders: number; total: number }[]
    discounts: { count: number; total: number }
    voids: { count: number; total: number }
    savedWithoutKot: number
    vatCollected: number
    invoiceRange: { from: number | null; to: number | null; count: number }
  }
}

/** Closed shifts on the counter that no day close has taken yet, oldest first. */
function pendingShiftIds(counterId: string): string[] {
  return db.select({ id: s.shifts.id }).from(s.shifts)
    .where(and(eq(s.shifts.counterId, counterId), isNotNull(s.shifts.closedAt), isNull(s.shifts.dayCloseId)))
    .orderBy(asc(s.shifts.openedAt))
    .all()
    .map((r) => r.id)
}

/** Add `v` into the entry for `key`, keeping first-seen order. */
function merge<T extends Record<string, number>>(map: Map<string, T>, key: string, v: T) {
  const e = map.get(key)
  if (!e) { map.set(key, { ...v }); return }
  for (const k of Object.keys(v) as (keyof T)[]) (e[k] as number) += v[k] as number
}

function buildReport(
  shiftIds: string[],
  head: { dayCloseId: string | null; counterName: string; closedBy: string | null; closedAt: Date | null },
): DayReport {
  const shifts = shiftIds.map((id) => zReport(id))

  const modes = new Map<string, { count: number; total: number }>()
  const modeType = new Map<string, string>()
  const types = new Map<string, { count: number; total: number }>()
  const waiters = new Map<string, { orders: number; total: number }>()
  for (const z of shifts) {
    for (const m of z.paymentModes) { merge(modes, m.name, { count: m.count, total: m.total }); modeType.set(m.name, m.type) }
    for (const t of z.orderTypes) merge(types, t.type, { count: t.count, total: t.total })
    for (const w of z.waiters) merge(waiters, w.name, { orders: w.orders, total: w.total })
  }

  // Every live expense recorded in these shifts, drawer or not. The shift
  // Z-reports only show drawer payouts; the day's expense total needs both.
  const expenseRows = shiftIds.length === 0 ? [] : db
    .select({ category: s.expenseCategories.name, amount: s.expenses.amount, paidFromDrawer: s.expenses.paidFromDrawer })
    .from(s.expenses)
    .innerJoin(s.expenseCategories, eq(s.expenses.expenseCategoryId, s.expenseCategories.id))
    .where(and(inArray(s.expenses.shiftId, shiftIds), isNull(s.expenses.deletedAt)))
    .orderBy(asc(s.expenses.createdAt))
    .all()
  const byCategory = new Map<string, { count: number; total: number }>()
  for (const e of expenseRows) merge(byCategory, e.category, { count: 1, total: e.amount })
  const drawer = expenseRows.filter((e) => e.paidFromDrawer).reduce((a, e) => a + e.amount, 0)
  const other = expenseRows.filter((e) => !e.paidFromDrawer).reduce((a, e) => a + e.amount, 0)

  const sumOf = (f: (z: ZReport) => number) => shifts.reduce((a, z) => a + f(z), 0)
  const froms = shifts.map((z) => z.invoiceRange.from).filter((n): n is number => n != null)
  const tos = shifts.map((z) => z.invoiceRange.to).filter((n): n is number => n != null)
  const last = shifts.at(-1)

  return {
    ...head,
    from: shifts[0]?.openedAt ?? null,
    to: last?.closedAt ?? null,
    shifts,
    totals: {
      paymentModes: [...modes].map(([name, v]) => ({ name, type: modeType.get(name)!, ...v })),
      grandTotal: sumOf((z) => z.grandTotal),
      cash: {
        openingFloats: sumOf((z) => z.cash.openingFloat),
        cashSales: sumOf((z) => z.cash.cashSales),
        drawerExpenses: sumOf((z) => z.cash.drawerExpenses),
        expected: sumOf((z) => z.cash.expected),
        counted: sumOf((z) => z.cash.counted ?? 0),
        variance: sumOf((z) => z.cash.variance ?? 0),
      },
      expenses: {
        drawer, other, total: drawer + other,
        byCategory: [...byCategory].map(([category, v]) => ({ category, ...v })),
      },
      orderTypes: [...types].map(([type, v]) => ({ type, ...v })),
      waiters: [...waiters].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
      discounts: { count: sumOf((z) => z.discounts.count), total: sumOf((z) => z.discounts.total) },
      voids: { count: sumOf((z) => z.voids.count), total: sumOf((z) => z.voids.total) },
      savedWithoutKot: sumOf((z) => z.savedWithoutKot),
      vatCollected: sumOf((z) => z.vatCollected),
      invoiceRange: {
        from: froms.length ? Math.min(...froms) : null,
        to: tos.length ? Math.max(...tos) : null,
        count: sumOf((z) => z.invoiceRange.count),
      },
    },
  }
}

/** What "Close day" would print now. The open shift, if any, is not in it. */
export function dayReportPreview(counterId: string) {
  const counter = requireCounter(counterId)
  const shiftOpen = openShiftIdFor(counterId) != null
  return {
    shiftOpen,
    report: buildReport(pendingShiftIds(counterId), {
      dayCloseId: null, counterName: counter.name, closedBy: null, closedAt: null,
    }),
  }
}

/** A day close already done, rebuilt from its shifts (they are frozen once closed). */
export function dayReport(dayCloseId: string): DayReport {
  const dc = db.select().from(s.dayCloses).where(eq(s.dayCloses.id, dayCloseId)).get()
  if (!dc) throw notFound('day close')
  const ids = db.select({ id: s.shifts.id }).from(s.shifts)
    .where(eq(s.shifts.dayCloseId, dayCloseId)).orderBy(asc(s.shifts.openedAt)).all().map((r) => r.id)
  const counter = db.select().from(s.counters).where(eq(s.counters.id, dc.counterId)).get()!
  const emp = db.select().from(s.employees).where(eq(s.employees.id, dc.employeeId)).get()
  return buildReport(ids, { dayCloseId, counterName: counter.name, closedBy: emp?.name ?? null, closedAt: dc.closedAt })
}

/** Recent day closes on a counter, newest first, for reprinting. */
export function listDayCloses(counterId: string, limit = 14) {
  return db.select().from(s.dayCloses)
    .where(eq(s.dayCloses.counterId, counterId))
    .orderBy(desc(s.dayCloses.closedAt))
    .limit(limit)
    .all()
    .map((dc) => {
      const r = dayReport(dc.id)
      return { id: dc.id, closedAt: dc.closedAt, closedBy: r.closedBy, shiftCount: r.shifts.length, grandTotal: r.totals.grandTotal }
    })
}

function queueDayReport(counterId: string, report: DayReport) {
  const counter = db.select().from(s.counters).where(eq(s.counters.id, counterId)).get()!
  const cfg = db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()!
  const payload: DayReportPayload = {
    businessName: cfg.businessName,
    currencyDisplay: cfg.currencyDisplay,
    currencyDecimals: cfg.currencyDecimals,
    taxName: cfg.taxName,
    invoicePrefix: cfg.invoicePrefix,
    day: report,
  }
  // Same 'report' kind as the Z-report: the renderer tells them apart by `day`.
  db.insert(s.printJobs).values({
    id: newId(), printerId: counter.printerId, kind: 'report',
    payloadJson: JSON.stringify(payload), refId: report.dayCloseId,
  }).run()
  printQueue.kick(counter.printerId)
}

/**
 * Close the counter's day: take every closed shift not yet in a day close and
 * print the combined report. The counter's shift must be closed first, so the
 * last shift's Z-report is already out and its cash counted.
 */
export function closeDay(counterId: string, employeeId: string) {
  requireEmployee(employeeId)
  requireCounter(counterId)
  if (openShiftIdFor(counterId)) {
    throw conflict('Close the current shift first. The day close comes after the last shift.')
  }
  const ids = pendingShiftIds(counterId)
  if (ids.length === 0) throw conflict('There are no closed shifts to put on a day close yet.')

  const id = newId()
  raw.transaction(() => {
    db.insert(s.dayCloses).values({ id, counterId, employeeId, closedAt: new Date() }).run()
    db.update(s.shifts).set({ dayCloseId: id }).where(inArray(s.shifts.id, ids)).run()
  })()

  const report = dayReport(id)
  queueDayReport(counterId, report)
  audit(employeeId, 'day.close', 'day_close', id, {
    counterId, shifts: ids.length, grandTotal: report.totals.grandTotal, variance: report.totals.cash.variance,
  })
  return report
}

/** Print a past day close again. */
export function reprintDayClose(dayCloseId: string, employeeId: string) {
  requireEmployee(employeeId)
  const report = dayReport(dayCloseId)
  const dc = db.select().from(s.dayCloses).where(eq(s.dayCloses.id, dayCloseId)).get()!
  queueDayReport(dc.counterId, report)
  audit(employeeId, 'day.reprint', 'day_close', dayCloseId)
  return { ok: true }
}
