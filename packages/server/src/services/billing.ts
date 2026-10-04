import { and, eq, ne, sum } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db, raw } from '../db.js'
import { conflict, forbidden, notFound } from '../errors.js'
import { printQueue } from '../queue.js'
import type { BillPayload } from '../templates.js'
import { requireCounter } from './counters.js'
import { requireEmployee } from './employees.js'
import { attachCustomer } from './customers.js'
import { recalculate } from './orders.js'
import { openShiftIdFor } from './shifts.js'

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
  /** Listed under the total once money has been taken. */
  payments?: { name: string; amount: number }[],
  revised = false,
  reprintCountOverride?: number,
): { payload: BillPayload; printerId: string } {
  const cfg = settings()
  const { order, lines, waiter, tableLabel } = orderContext(orderId)
  const counter = db.select().from(s.counters).where(eq(s.counters.id, counterId)).get()
  if (!counter) throw notFound('counter')

  const payload: BillPayload = {
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
    customerName: order.customerName,
    customerPhone: order.phoneSnapshot,
    deliveryAddress: order.type === 'delivery' ? order.addressSnapshot : null,
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

function paymentRows(orderId: string) {
  return db
    .select({ amount: s.payments.amount, name: s.paymentModes.name })
    .from(s.payments)
    .innerJoin(s.paymentModes, eq(s.payments.paymentModeId, s.paymentModes.id))
    .where(eq(s.payments.orderId, orderId))
    .all()
}

/** Pop the cash drawer on the counter's printer without printing any paper. */
function queueDrawerKick(orderId: string, counterId: string) {
  const counter = db.select().from(s.counters).where(eq(s.counters.id, counterId)).get()
  if (!counter) throw notFound('counter')
  db.insert(s.printJobs).values({
    id: newId(), printerId: counter.printerId, kind: 'drawer', payloadJson: '{}', refId: orderId,
  }).run()
  printQueue.kick(counter.printerId)
}

/**
 * Print the customer's bill, which is also the tax invoice.
 *
 * There is one customer document, not two. From its first print the bill
 * carries the gapless invoice number, the TRN and the VAT breakdown, and
 * settlement prints nothing more unless the paper the customer holds is missing
 * or out of date (see `settle`). Printing a second "tax invoice" at the till
 * only wasted paper and confused customers holding two slips for one meal.
 *
 * The invoice number is allocated on first print and stays with the order.
 * After settlement this is a reprint: the payments are listed and the order's
 * settling counter is left alone, because that is what the Z-report counts.
 */
export function printBill(orderId: string, employeeId: string, counterId: string) {
  requireEmployee(employeeId)
  requireCounter(counterId)
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'void') throw conflict('This order was cancelled.')
  const settled = order.status === 'settled'

  // A settled invoice is final. Recalculating would apply today's tax settings
  // to it.
  if (!settled) recalculate(orderId)

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
        ...(settled ? {} : { counterId }),
        lastPrintedAt: new Date(),
        dirtySincePrint: false,
      }).where(eq(s.orders.id, orderId)).run()
    }
  })()

  const { payload, printerId } = buildPayload(
    orderId, counterId, settled ? paymentRows(orderId) : undefined, revised,
  )
  db.insert(s.printJobs).values({
    id: newId(), printerId, kind: 'bill',
    payloadJson: JSON.stringify(payload), refId: orderId,
  }).run()
  printQueue.kick(printerId)

  const fresh = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()!
  audit(employeeId, 'bill.print', 'order', orderId, { reprint: fresh.reprintCount, settled })
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
 * Take payment.
 *
 * Payments are a child table, so a customer paying part cash and part card is
 * one order with two rows — and day-wise merchant totals are a GROUP BY.
 *
 * Settling prints the bill only when the customer has no correct one: it was
 * never printed (a quick takeaway settled straight away), or lines or the
 * discount changed since it was. Otherwise the bill in their hand already is
 * the tax invoice, and a cash payment just opens the drawer.
 */
export function settle(
  orderId: string,
  input: {
    payments: { paymentModeId: string; amount: number; refNo?: string | null }[]
    employeeId: string
    counterId: string
    /** Asked at the till. Saved as a customer, unique by phone, for CRM later. */
    customer?: { name?: string | null; phone?: string | null } | null
  },
) {
  requireEmployee(input.employeeId)
  requireCounter(input.counterId)
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'settled') throw conflict('Order is already settled.')
  if (order.status === 'void') throw conflict('This order was cancelled.')

  // Every payment belongs to the shift open on this counter. A payment outside
  // a shift is in no Z-report: the cash would be in the drawer and missing
  // from the count.
  const shiftId = openShiftIdFor(input.counterId)
  if (!shiftId) {
    throw conflict('No shift is open on this counter. Open the counter before taking payment.')
  }

  // Before the bill is built, so the name and phone print on it.
  if (input.customer) attachCustomer(orderId, input.customer)

  recalculate(orderId)
  const current = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()!
  const wasPrinted = current.invoiceNo != null

  let openedDrawer = false
  let tendered = 0
  raw.transaction(() => {
    if (!wasPrinted) {
      db.update(s.orders).set({
        invoiceNo: allocateInvoiceNo(),
        billedAt: new Date(),
      }).where(eq(s.orders.id, orderId)).run()
    }

    let remaining = current.total - paidSoFar(orderId)

    for (const p of input.payments) {
      const mode = db.select().from(s.paymentModes).where(eq(s.paymentModes.id, p.paymentModeId)).get()
      if (!mode) throw notFound('payment mode')
      if (mode.requiresRef && !p.refNo) throw conflict(`${mode.name} needs an approval or reference number.`)
      if (p.amount <= 0) throw conflict('Payment amount must be positive.')
      if (mode.opensCashDrawer) openedDrawer = true

      tendered += p.amount
      // Record what actually settles the bill, not what was handed over. The
      // drawer gains tendered minus change, so storing the tendered amount
      // would inflate cash sales on the Z-report by every coin of change given.
      const applied = Math.max(0, Math.min(p.amount, remaining))
      remaining -= applied
      if (applied === 0) continue

      db.insert(s.payments).values({
        id: newId(), orderId, paymentModeId: mode.id, amount: applied,
        refNo: p.refNo ?? null, counterId: input.counterId,
        shiftId, createdBy: input.employeeId,
      }).run()
    }
  })()

  const paid = paidSoFar(orderId)
  if (paid < current.total) {
    // Partial payment is legitimate — the order stays open for the rest.
    if (openedDrawer) queueDrawerKick(orderId, input.counterId)
    return { settled: false, paid, balanceDue: current.total - paid }
  }

  const needsPrint = !wasPrinted || current.dirtySincePrint
  const reprintCount = wasPrinted && needsPrint ? current.reprintCount + 1 : current.reprintCount

  db.update(s.orders).set({
    status: 'settled',
    settledAt: new Date(),
    counterId: input.counterId,
    shiftId,
    ...(needsPrint ? { reprintCount, lastPrintedAt: new Date(), dirtySincePrint: false } : {}),
  }).where(eq(s.orders.id, orderId)).run()

  if (needsPrint) {
    const { payload, printerId } = buildPayload(
      orderId, input.counterId, paymentRows(orderId), wasPrinted, reprintCount,
    )
    db.insert(s.printJobs).values({
      id: newId(), printerId, kind: 'bill',
      payloadJson: JSON.stringify({ ...payload, openDrawer: openedDrawer }), refId: orderId,
    }).run()
    printQueue.kick(printerId)
  } else if (openedDrawer) {
    queueDrawerKick(orderId, input.counterId)
  }

  const fresh = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()!
  audit(input.employeeId, 'order.settle', 'order', orderId, { invoiceNo: fresh.invoiceNo, paid, printed: needsPrint })
  return {
    settled: true, paid, changeDue: Math.max(0, tendered - current.total),
    invoiceNo: fresh.invoiceNo, printed: needsPrint,
  }
}

/** Bill-level discount. Gated on the employee's permission and their cap. */
export function applyDiscount(
  orderId: string,
  input: { type: 'none' | 'percent' | 'amount'; value: number; reason?: string | null; employeeId: string },
) {
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'settled' || order.status === 'void') throw conflict('Order is locked.')

  const emp = requireEmployee(input.employeeId)
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
