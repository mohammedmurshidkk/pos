import { and, eq, ne, sum } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db, raw } from '../db.js'
import { conflict, forbidden, notFound } from '../errors.js'
import { printQueue } from '../queue.js'
import type { BillPayload } from '../templates.js'
import { recalculate } from './orders.js'

const s = schema
const stamp = () => new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

function settings() {
  const row = db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()
  if (!row) throw new Error('settings missing — run `pnpm seed`')
  return row
}

/**
 * Allocate the next invoice number.
 *
 * Gapless and sequential, inside a transaction so two tills can never take the
 * same number. A number is never reused — a cancelled order keeps its number as
 * a void record, because the FTA cares about MISSING numbers, not voided ones.
 */
function allocateInvoiceNo(): number {
  return raw.transaction(() => {
    const row = raw.prepare('select invoice_next_no as n from settings where id = ?').get('singleton') as { n: number }
    raw.prepare('update settings set invoice_next_no = ? where id = ?').run(row.n + 1, 'singleton')
    return row.n
  })()
}

function orderContext(orderId: string) {
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')

  const lines = db
    .select()
    .from(s.orderItems)
    .where(and(eq(s.orderItems.orderId, orderId), ne(s.orderItems.status, 'void')))
    .all()

  const waiter = order.waiterId
    ? db.select().from(s.employees).where(eq(s.employees.id, order.waiterId)).get()
    : null

  const tableLabel = order.tableId
    ? (() => {
        const t = db.select().from(s.tables).where(eq(s.tables.id, order.tableId!)).get()
        if (!t) return null
        const a = db.select().from(s.areas).where(eq(s.areas.id, t.areaId)).get()
        return a ? `${t.name} - ${a.name}` : t.name
      })()
    : order.vehicleNo ?? order.phoneSnapshot ?? null

  return { order, lines, waiter, tableLabel }
}

function buildPayload(
  orderId: string,
  counterId: string,
  isTaxInvoice: boolean,
  payments?: { name: string; amount: number }[],
  revised = false,
  /**
   * Bill reprints and invoice reprints are different counters. The tax invoice
   * issued at settlement is always an original, however many bills were printed
   * on the way there.
   */
  reprintCountOverride?: number,
): { payload: BillPayload; printerId: string } {
  const cfg = settings()
  const { order, lines, waiter, tableLabel } = orderContext(orderId)
  const counter = db.select().from(s.counters).where(eq(s.counters.id, counterId)).get()
  if (!counter) throw notFound('counter')

  const payload: BillPayload = {
    isTaxInvoice,
    businessName: cfg.businessName,
    addressLine: cfg.addressLine,
    phone: cfg.phone,
    taxNumberLabel: cfg.taxNumberLabel,
    taxNumberValue: cfg.taxNumberValue,
    taxName: cfg.taxName,
    taxRatePct: cfg.taxRateBp / 100,
    currencyDisplay: cfg.currencyDisplay,
    currencyDecimals: cfg.currencyDecimals,
    invoiceNo: order.invoiceNo ? `${cfg.invoicePrefix}${order.invoiceNo}` : null,
    orderNo: order.orderNo,
    orderType: order.type,
    tableLabel,
    waiterName: waiter?.name ?? 'Counter',
    counterName: counter.name,
    at: stamp(),
    reprintCount: reprintCountOverride ?? order.reprintCount,
    wasEditedAfterPrint: revised,
    lines: lines.map((l) => ({
      qty: l.qty,
      name: l.nameSnapshot,
      amount: l.qty * (l.unitPriceSnapshot + (JSON.parse(l.modifiersJson) as { priceDelta: number }[]).reduce((a, m) => a + m.priceDelta, 0)),
      modifiers: (JSON.parse(l.modifiersJson) as { name: string }[]).map((m) => m.name),
      note: l.note,
    })),
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    serviceCharge: order.serviceCharge,
    net: order.total - order.taxAmount,
    tax: order.taxAmount,
    total: order.total,
    payments,
    footer: cfg.receiptFooter,
  }

  return { payload, printerId: counter.printerId }
}

/**
 * Print the customer's BILL — not a tax invoice.
 *
 * The invoice number is allocated here, on first print, and stays with the
 * order as items are added. Settlement is what turns it into a tax invoice.
 */
export function printBill(orderId: string, employeeId: string, counterId: string) {
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'void') throw conflict('This order was cancelled.')
  if (order.status === 'settled') throw conflict('Order is settled. Reprint the invoice instead.')

  recalculate(orderId)

  // Read the dirty flag BEFORE clearing it — this is what decides REVISED.
  const isReprint = order.invoiceNo != null
  const revised = isReprint && order.dirtySincePrint

  raw.transaction(() => {
    if (!isReprint) {
      db.update(s.orders).set({
        invoiceNo: allocateInvoiceNo(),
        status: 'billed',
        billedAt: new Date(),
        counterId,
        lastPrintedAt: new Date(),
        dirtySincePrint: false,
      }).where(eq(s.orders.id, orderId)).run()
    } else {
      db.update(s.orders).set({
        reprintCount: order.reprintCount + 1,
        counterId,
        lastPrintedAt: new Date(),
        dirtySincePrint: false,
      }).where(eq(s.orders.id, orderId)).run()
    }
  })()

  const { payload, printerId } = buildPayload(orderId, counterId, false, undefined, revised)
  db.insert(s.printJobs).values({
    id: newId(), printerId, kind: 'bill',
    payloadJson: JSON.stringify(payload), refId: orderId,
  }).run()
  printQueue.kick(printerId)

  const fresh = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()!
  audit(employeeId, 'bill.print', 'order', orderId, { reprint: fresh.reprintCount })
  return { invoiceNo: fresh.invoiceNo, reprintCount: fresh.reprintCount, revised: payload.wasEditedAfterPrint }
}

export function paidSoFar(orderId: string): number {
  const [row] = db
    .select({ total: sum(s.payments.amount) })
    .from(s.payments)
    .where(eq(s.payments.orderId, orderId))
    .all()
  return Number(row?.total ?? 0)
}

/**
 * Take payment and issue the TAX INVOICE.
 *
 * Payments are a child table, so a customer paying part cash and part card is
 * one order with two rows — and day-wise merchant totals are a GROUP BY.
 */
export function settle(
  orderId: string,
  input: { payments: { paymentModeId: string; amount: number; refNo?: string | null }[]; employeeId: string; counterId: string; shiftId?: string | null },
) {
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'settled') throw conflict('Order is already settled.')
  if (order.status === 'void') throw conflict('This order was cancelled.')

  recalculate(orderId)
  const current = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()!

  let openedDrawer = false
  raw.transaction(() => {
    if (current.invoiceNo == null) {
      db.update(s.orders).set({
        invoiceNo: allocateInvoiceNo(),
        billedAt: new Date(),
      }).where(eq(s.orders.id, orderId)).run()
    }

    for (const p of input.payments) {
      const mode = db.select().from(s.paymentModes).where(eq(s.paymentModes.id, p.paymentModeId)).get()
      if (!mode) throw notFound('payment mode')
      if (mode.requiresRef && !p.refNo) throw conflict(`${mode.name} needs an approval or reference number.`)
      if (mode.opensCashDrawer) openedDrawer = true
      db.insert(s.payments).values({
        id: newId(), orderId, paymentModeId: mode.id, amount: p.amount,
        refNo: p.refNo ?? null, counterId: input.counterId,
        shiftId: input.shiftId ?? null, createdBy: input.employeeId,
      }).run()
    }
  })()

  const paid = paidSoFar(orderId)
  if (paid < current.total) {
    // Partial payment is legitimate — the order stays open for the rest.
    return { settled: false, paid, balanceDue: current.total - paid }
  }

  db.update(s.orders).set({
    status: 'settled',
    settledAt: new Date(),
    counterId: input.counterId,
    shiftId: input.shiftId ?? null,
  }).where(eq(s.orders.id, orderId)).run()

  const paymentRows = db
    .select({ amount: s.payments.amount, name: s.paymentModes.name })
    .from(s.payments)
    .innerJoin(s.paymentModes, eq(s.payments.paymentModeId, s.paymentModes.id))
    .where(eq(s.payments.orderId, orderId))
    .all()

  const { payload, printerId } = buildPayload(orderId, input.counterId, true, paymentRows, false, 0)
  db.insert(s.printJobs).values({
    id: newId(), printerId, kind: 'invoice',
    payloadJson: JSON.stringify({ ...payload, openDrawer: openedDrawer }), refId: orderId,
  }).run()
  printQueue.kick(printerId)

  const fresh = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()!
  audit(input.employeeId, 'order.settle', 'order', orderId, { invoiceNo: fresh.invoiceNo, paid })
  return { settled: true, paid, changeDue: paid - current.total, invoiceNo: fresh.invoiceNo }
}

/** Bill-level discount. Gated on the employee's permission and their cap. */
export function applyDiscount(
  orderId: string,
  input: { type: 'none' | 'percent' | 'amount'; value: number; reason?: string | null; employeeId: string },
) {
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'settled' || order.status === 'void') throw conflict('Order is locked.')

  const emp = db.select().from(s.employees).where(eq(s.employees.id, input.employeeId)).get()
  if (!emp) throw notFound('employee')
  if (input.type !== 'none' && !emp.canDiscount) {
    throw forbidden(`${emp.name} is not permitted to apply discounts.`)
  }
  if (input.type === 'percent' && input.value > emp.maxDiscountPercent) {
    throw forbidden(`${emp.name} can discount up to ${emp.maxDiscountPercent}%.`)
  }

  db.update(s.orders).set({
    discountType: input.type,
    discountValue: input.type === 'none' ? 0 : input.value,
    discountReason: input.reason ?? null,
    discountBy: input.employeeId,
    dirtySincePrint: true,
  }).where(eq(s.orders.id, orderId)).run()

  const result = recalculate(orderId)
  audit(input.employeeId, 'order.discount', 'order', orderId, {
    type: input.type, value: input.value, amount: result.discountAmount, reason: input.reason,
  })
  return result
}
