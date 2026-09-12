import { and, eq, ne } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db, raw } from '../db.js'
import { conflict, notFound } from '../errors.js'
import { printQueue } from '../queue.js'
import type { KotPayload } from '../templates.js'
import { recalculate } from './orders.js'

const s = schema
const stamp = () =>
  new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Resolve the kitchen a line was sent to, so the cancellation reaches the same
 * station that received the original ticket.
 */
function kitchenForLine(itemId: string): string | null {
  const item = db.select().from(s.items).where(eq(s.items.id, itemId)).get()
  if (!item) return null
  const cat = db.select().from(s.categories).where(eq(s.categories.id, item.categoryId)).get()
  if (!cat) return null
  if (cat.kitchenId) return cat.kitchenId
  return db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()?.defaultKitchenId ?? null
}

function queueCancelTicket(
  orderId: string,
  kitchenId: string,
  lines: { qty: number; name: string }[],
  reason: string,
  byName: string,
) {
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()!
  const kitchen = db.select().from(s.kitchens).where(eq(s.kitchens.id, kitchenId)).get()
  if (!kitchen) return

  const tableLabel = order.tableId
    ? (() => {
        const t = db.select().from(s.tables).where(eq(s.tables.id, order.tableId!)).get()
        if (!t) return null
        const a = db.select().from(s.areas).where(eq(s.areas.id, t.areaId)).get()
        return a ? `${t.name} - ${a.name}` : t.name
      })()
    : order.vehicleNo ?? null

  const seq =
    db.select({ seq: s.kotTickets.seq }).from(s.kotTickets).where(eq(s.kotTickets.orderId, orderId)).all()
      .reduce((m, r) => Math.max(m, r.seq), 0)

  const payload: KotPayload = {
    kitchenName: kitchen.name,
    orderNo: order.orderNo,
    seq,
    kind: 'void',
    orderType: order.type,
    tableLabel,
    ticketLabel: order.ticketLabel,
    waiterName: byName,
    at: stamp(),
    lines: lines.map((l) => ({ qty: l.qty, name: l.name })),
    voidReason: reason,
  }

  const ticketId = newId()
  db.insert(s.kotTickets).values({
    id: ticketId, orderId, kitchenId, seq, kind: 'void',
    linesJson: JSON.stringify(payload.lines),
  }).run()
  db.insert(s.printJobs).values({
    id: newId(), printerId: kitchen.printerId, kind: 'void',
    payloadJson: JSON.stringify(payload), refId: ticketId,
  }).run()
  printQueue.kick(kitchen.printerId)
}

/**
 * Void one line. Counter PC only — the tablet has no void control at all,
 * which removes the order-food-then-void theft vector.
 *
 * A line the kitchen actually received MUST produce a cancellation ticket,
 * or they cook food nobody ordered.
 */
export function voidLine(orderId: string, lineId: string, reason: string, employeeId: string) {
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'settled') throw conflict('Order is settled — a refund is needed, not a void.')

  const line = db.select().from(s.orderItems).where(eq(s.orderItems.id, lineId)).get()
  if (!line || line.orderId !== orderId) throw notFound('order line')
  if (line.status === 'void') throw conflict('That line is already voided.')
  if (!reason?.trim()) throw conflict('A reason is required to void.')

  const emp = db.select().from(s.employees).where(eq(s.employees.id, employeeId)).get()
  if (!emp) throw notFound('employee')

  // Only tell the kitchen if the kitchen was ever told. A line saved without a
  // KOT, or never sent, has nothing to cancel.
  const needsCancelTicket = line.status === 'sent' && !line.kotSuppressed

  raw.transaction(() => {
    db.update(s.orderItems)
      .set({ status: 'void', voidReason: reason, voidedBy: employeeId, voidedAt: new Date() })
      .where(eq(s.orderItems.id, lineId))
      .run()
  })()

  if (needsCancelTicket) {
    const kitchenId = kitchenForLine(line.itemId)
    if (kitchenId) {
      queueCancelTicket(orderId, kitchenId, [{ qty: line.qty, name: line.nameSnapshot }], reason, emp.name)
    }
  }

  db.update(s.orders).set({ dirtySincePrint: true }).where(eq(s.orders.id, orderId)).run()
  const totals = recalculate(orderId)
  audit(employeeId, 'line.void', 'order_item', lineId, {
    orderId, name: line.nameSnapshot, qty: line.qty, reason, cancelTicket: needsCancelTicket,
  })
  return { voided: true, cancelTicketSent: needsCancelTicket, totals }
}

/** Void the whole order. The invoice number, if allocated, is kept — never reused. */
export function voidOrder(orderId: string, reason: string, employeeId: string) {
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'settled') throw conflict('Order is settled — a refund is needed, not a void.')
  if (order.status === 'void') throw conflict('Order is already cancelled.')
  if (!reason?.trim()) throw conflict('A reason is required to cancel an order.')

  const emp = db.select().from(s.employees).where(eq(s.employees.id, employeeId)).get()
  if (!emp) throw notFound('employee')

  const live = db
    .select()
    .from(s.orderItems)
    .where(and(eq(s.orderItems.orderId, orderId), ne(s.orderItems.status, 'void')))
    .all()

  // One cancellation ticket per kitchen, not one per line.
  const byKitchen = new Map<string, { qty: number; name: string }[]>()
  for (const l of live) {
    if (l.status !== 'sent' || l.kotSuppressed) continue
    const k = kitchenForLine(l.itemId)
    if (!k) continue
    const arr = byKitchen.get(k) ?? []
    arr.push({ qty: l.qty, name: l.nameSnapshot })
    byKitchen.set(k, arr)
  }

  raw.transaction(() => {
    db.update(s.orderItems)
      .set({ status: 'void', voidReason: reason, voidedBy: employeeId, voidedAt: new Date() })
      .where(and(eq(s.orderItems.orderId, orderId), ne(s.orderItems.status, 'void')))
      .run()
    db.update(s.orders).set({ status: 'void' }).where(eq(s.orders.id, orderId)).run()
  })()

  for (const [kitchenId, lines] of byKitchen) {
    queueCancelTicket(orderId, kitchenId, lines, reason, emp.name)
  }

  audit(employeeId, 'order.void', 'order', orderId, {
    reason, invoiceNo: order.invoiceNo, kitchensNotified: [...byKitchen.keys()].length,
  })
  return { voided: true, invoiceNo: order.invoiceNo, kitchensNotified: byKitchen.size }
}

/** Remove an unsent line. Not a void — the kitchen never heard about it. */
export function removeUnsentLine(orderId: string, lineId: string) {
  const line = db.select().from(s.orderItems).where(eq(s.orderItems.id, lineId)).get()
  if (!line || line.orderId !== orderId) throw notFound('order line')
  if (line.status !== 'new') throw conflict('That line has already been sent — void it instead.')
  db.delete(s.orderItems).where(eq(s.orderItems.id, lineId)).run()
  db.update(s.orders).set({ dirtySincePrint: true }).where(eq(s.orders.id, orderId)).run()
  return recalculate(orderId)
}
