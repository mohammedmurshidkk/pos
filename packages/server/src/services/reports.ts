import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { schema } from '@pos/shared'
import { db } from '../db.js'
import { conflict } from '../errors.js'

const s = schema

export type RangePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom'
export interface Range { from: Date; to: Date; label: string }

function businessDayStart(): number {
  return db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()?.businessDayStartHour ?? 0
}

/** Start of the business day containing `at`, honouring the rollover hour. */
function dayStart(at: Date, startHour: number): Date {
  const d = new Date(at)
  d.setHours(startHour, 0, 0, 0)
  // Before the rollover hour we are still in yesterday's business day.
  if (at.getHours() < startHour) d.setDate(d.getDate() - 1)
  return d
}

const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function resolveRange(input: { preset?: RangePreset; from?: string; to?: string }): Range {
  const startHour = businessDayStart()
  const now = new Date()
  const today = dayStart(now, startHour)

  switch (input.preset) {
    case 'today':
      return { from: today, to: addDays(today, 1), label: 'Today' }
    case 'yesterday':
      return { from: addDays(today, -1), to: today, label: 'Yesterday' }
    case 'this_week': {
      // Week starts Monday — Gulf weekends vary, but Mon-Sun reads naturally
      // on a report and the owner can always pick a custom range.
      const dow = (today.getDay() + 6) % 7
      const from = addDays(today, -dow)
      return { from, to: addDays(from, 7), label: 'This week' }
    }
    case 'this_month': {
      const from = new Date(today)
      from.setDate(1)
      const to = new Date(from)
      to.setMonth(to.getMonth() + 1)
      return { from, to, label: 'This month' }
    }
    default: {
      if (!input.from || !input.to) throw conflict('A custom range needs both from and to.')
      const from = new Date(input.from)
      const to = new Date(input.to)
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw conflict('Invalid date range.')
      if (to < from) throw conflict('The end of the range is before the start.')
      return { from, to, label: `${from.toLocaleDateString('en-GB')} - ${to.toLocaleDateString('en-GB')}` }
    }
  }
}

/**
 * Revenue is recognised at settlement, so every report keys off `settledAt`.
 * Open, billed and cancelled orders never appear.
 */
function settledOrders(range: Range) {
  return db
    .select()
    .from(s.orders)
    .where(and(
      eq(s.orders.status, 'settled'),
      gte(s.orders.settledAt, range.from),
      lte(s.orders.settledAt, range.to),
    ))
    .all()
}

/** Live (non-void) lines of the given orders, with modifier deltas folded in. */
function linesOf(orderIds: string[]) {
  if (orderIds.length === 0) return []
  return db
    .select()
    .from(s.orderItems)
    .where(and(inArray(s.orderItems.orderId, orderIds), ne(s.orderItems.status, 'void')))
    .all()
    .map((l) => {
      const mods = JSON.parse(l.modifiersJson) as { priceDelta: number }[]
      const unit = l.unitPriceSnapshot + mods.reduce((a, m) => a + m.priceDelta, 0)
      return { ...l, unit, gross: l.qty * unit }
    })
}

export interface SalesSummary {
  range: { from: string; to: string; label: string }
  orders: number
  grossSales: number
  discounts: number
  serviceCharge: number
  net: number
  tax: number
  total: number
  averageTicket: number
}

/**
 * The headline numbers. These reconcile exactly:
 *   grossSales - discounts + serviceCharge = total, and net + tax = total.
 */
export function salesSummary(range: Range): SalesSummary {
  const orders = settledOrders(range)
  const lines = linesOf(orders.map((o) => o.id))
  const grossSales = lines.reduce((a, l) => a + l.gross, 0)
  const discounts = orders.reduce((a, o) => a + o.discountAmount, 0)
  const serviceCharge = orders.reduce((a, o) => a + o.serviceCharge, 0)
  const tax = orders.reduce((a, o) => a + o.taxAmount, 0)
  const total = orders.reduce((a, o) => a + o.total, 0)

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    orders: orders.length,
    grossSales,
    discounts,
    serviceCharge,
    net: total - tax,
    tax,
    total,
    averageTicket: orders.length === 0 ? 0 : Math.round(total / orders.length),
  }
}

export function itemWise(range: Range) {
  const orders = settledOrders(range)
  const byItem = new Map<string, { name: string; qty: number; gross: number }>()
  for (const l of linesOf(orders.map((o) => o.id))) {
    const e = byItem.get(l.itemId) ?? { name: l.nameSnapshot, qty: 0, gross: 0 }
    e.qty += l.qty
    e.gross += l.gross
    byItem.set(l.itemId, e)
  }
  return [...byItem]
    .map(([itemId, v]) => ({ itemId, ...v }))
    .sort((a, b) => b.gross - a.gross)
}

export function categoryWise(range: Range) {
  const orders = settledOrders(range)
  const byCat = new Map<string, { name: string; qty: number; gross: number }>()
  for (const l of linesOf(orders.map((o) => o.id))) {
    const item = db.select().from(s.items).where(eq(s.items.id, l.itemId)).get()
    const cat = item ? db.select().from(s.categories).where(eq(s.categories.id, item.categoryId)).get() : null
    const key = cat?.id ?? 'uncategorised'
    const e = byCat.get(key) ?? { name: cat?.name ?? 'Uncategorised', qty: 0, gross: 0 }
    e.qty += l.qty
    e.gross += l.gross
    byCat.set(key, e)
  }
  return [...byCat].map(([categoryId, v]) => ({ categoryId, ...v })).sort((a, b) => b.gross - a.gross)
}

/** Credits the order owner (`waiterId`), never whoever keyed it. */
export function employeeWise(range: Range) {
  const orders = settledOrders(range)
  const byEmp = new Map<string, { orders: number; total: number }>()
  for (const o of orders) {
    const key = o.waiterId ?? 'counter'
    const e = byEmp.get(key) ?? { orders: 0, total: 0 }
    e.orders += 1
    e.total += o.total
    byEmp.set(key, e)
  }
  return [...byEmp]
    .map(([id, v]) => ({
      employeeId: id,
      name: id === 'counter' ? 'Counter' : db.select().from(s.employees).where(eq(s.employees.id, id)).get()?.name ?? 'Unknown',
      ...v,
      averageTicket: v.orders === 0 ? 0 : Math.round(v.total / v.orders),
    }))
    .sort((a, b) => b.total - a.total)
}

export function paymentModeWise(range: Range) {
  const orders = settledOrders(range)
  if (orders.length === 0) return []
  const rows = db
    .select({ amount: s.payments.amount, name: s.paymentModes.name, type: s.paymentModes.type, merchant: s.paymentModes.merchantName })
    .from(s.payments)
    .innerJoin(s.paymentModes, eq(s.payments.paymentModeId, s.paymentModes.id))
    .where(inArray(s.payments.orderId, orders.map((o) => o.id)))
    .all()

  const byMode = new Map<string, { name: string; type: string; merchant: string | null; count: number; total: number }>()
  for (const r of rows) {
    const e = byMode.get(r.name) ?? { name: r.name, type: r.type, merchant: r.merchant, count: 0, total: 0 }
    e.count += 1
    e.total += r.amount
    byMode.set(r.name, e)
  }
  return [...byMode.values()].sort((a, b) => b.total - a.total)
}

export function orderTypeWise(range: Range) {
  const orders = settledOrders(range)
  const byType = new Map<string, { count: number; total: number }>()
  for (const o of orders) {
    const e = byType.get(o.type) ?? { count: 0, total: 0 }
    e.count += 1
    e.total += o.total
    byType.set(o.type, e)
  }
  return [...byType].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.total - a.total)
}

/** The report the owner reads when he suspects something. */
export function discountsAndVoids(range: Range) {
  const orders = settledOrders(range)
  const discounts = orders
    .filter((o) => o.discountAmount > 0)
    .map((o) => ({
      orderNo: o.orderNo,
      invoiceNo: o.invoiceNo,
      amount: o.discountAmount,
      type: o.discountType,
      value: o.discountValue,
      reason: o.discountReason,
      by: o.discountBy ? db.select().from(s.employees).where(eq(s.employees.id, o.discountBy)).get()?.name ?? null : null,
      at: o.settledAt,
    }))

  // Voids are keyed on when the void happened, not when the order settled —
  // a cancelled order never settles and would otherwise never be reported.
  const voids = db
    .select()
    .from(s.orderItems)
    .where(and(
      eq(s.orderItems.status, 'void'),
      gte(s.orderItems.voidedAt, range.from),
      lte(s.orderItems.voidedAt, range.to),
    ))
    .all()
    .map((l) => {
      const mods = JSON.parse(l.modifiersJson) as { priceDelta: number }[]
      const unit = l.unitPriceSnapshot + mods.reduce((a, m) => a + m.priceDelta, 0)
      const order = db.select().from(s.orders).where(eq(s.orders.id, l.orderId)).get()
      return {
        orderNo: order?.orderNo ?? null,
        name: l.nameSnapshot,
        qty: l.qty,
        amount: l.qty * unit,
        reason: l.voidReason,
        by: l.voidedBy ? db.select().from(s.employees).where(eq(s.employees.id, l.voidedBy)).get()?.name ?? null : null,
        at: l.voidedAt,
      }
    })

  return {
    discounts,
    voids,
    totals: {
      discountCount: discounts.length,
      discountTotal: discounts.reduce((a, d) => a + d.amount, 0),
      voidCount: voids.length,
      voidTotal: voids.reduce((a, v) => a + v.amount, 0),
    },
  }
}

export function taxSummary(range: Range) {
  const cfg = db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()!
  const orders = settledOrders(range)
  const total = orders.reduce((a, o) => a + o.total, 0)
  const tax = orders.reduce((a, o) => a + o.taxAmount, 0)
  const invoiceNos = orders.map((o) => o.invoiceNo).filter((n): n is number => n != null).sort((a, b) => a - b)
  return {
    taxName: cfg.taxName,
    taxRatePct: cfg.taxRateBp / 100,
    taxNumberLabel: cfg.taxNumberLabel,
    taxNumberValue: cfg.taxNumberValue,
    invoices: invoiceNos.length,
    invoiceFrom: invoiceNos[0] ?? null,
    invoiceTo: invoiceNos.at(-1) ?? null,
    invoiceRange: { from: invoiceNos[0] ?? null, to: invoiceNos.at(-1) ?? null },
    net: total - tax,
    tax,
    total,
  }
}

/** RFC 4180 CSV. Money is emitted as decimals so spreadsheets sum it. */
export function toCsv(rows: Record<string, unknown>[], moneyKeys: string[] = [], decimals = 2): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0]!)
  const cell = (key: string, value: unknown): string => {
    if (value == null) return ''
    if (moneyKeys.includes(key) && typeof value === 'number') return (value / 10 ** decimals).toFixed(decimals)
    // Never let a nested value land in a cell as "[object Object]".
    const str =
      value instanceof Date ? value.toISOString()
      : typeof value === 'object' ? JSON.stringify(value)
      : String(value)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }
  return [headers.join(','), ...rows.map((r) => headers.map((h) => cell(h, r[h])).join(','))].join('\n')
}
