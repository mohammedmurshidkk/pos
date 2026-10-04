import { and, desc, eq, gte, inArray, lt, ne, or } from 'drizzle-orm'
import { calculate, kotKindForSeq, newId, nextKotSeq, routeToKitchens, schema, type CalcLine } from '@pos/shared'
import { db, raw } from '../db.js'
import { audit } from '../audit.js'
import { conflict, forbidden, notFound } from '../errors.js'
import { printQueue } from '../queue.js'
import type { KotPayload } from '../templates.js'
import { requireEmployee } from './employees.js'
import { assertLicensed } from './licence.js'
import { normalizePhone, saveCustomer } from './customers.js'

const s = schema

export interface NewLine {
  itemId: string
  qty: number
  note?: string | null
  modifiers?: { id: string; name: string; priceDelta: number }[]
}

const now = () => new Date()
const stamp = () =>
  new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function getSettings() {
  const [row] = db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).all()
  if (!row) throw new Error('settings missing — run `pnpm seed`')
  return row
}

/** Allocated inside a transaction so two tills can never take the same number. */
function nextOrderNo(): number {
  return raw.transaction(() => {
    const row = raw.prepare('select order_next_no as n from settings where id = ?').get('singleton') as { n: number }
    raw.prepare('update settings set order_next_no = ? where id = ?').run(row.n + 1, 'singleton')
    return row.n
  })()
}

export function createOrder(input: {
  type: 'dine_in' | 'takeaway' | 'car' | 'delivery'
  tableId?: string | null
  ticketLabel?: string | null
  vehicleNo?: string | null
  bayNo?: string | null
  phoneSnapshot?: string | null
  addressSnapshot?: string | null
  customerName?: string | null
  createdBy: string
}) {
  requireEmployee(input.createdBy)
  // Covers submitOrder too — it only creates via here. Add-on rounds to an
  // order that already exists skip this, so an expiry never strands a table.
  assertLicensed('new order')
  const id = newId()
  // A phone number makes (or updates) the customer, unique by phone. Takeaway
  // used to carry its name only as the ticket label, so fall back to that.
  const customerName = input.customerName?.trim() || (input.type === 'dine_in' ? null : input.ticketLabel?.trim() || null)
  const phone = normalizePhone(input.phoneSnapshot) || null
  const customerId = saveCustomer({
    phone, name: customerName, address: input.type === 'delivery' ? input.addressSnapshot : null,
  })
  db.insert(s.orders).values({
    id,
    orderNo: nextOrderNo(),
    type: input.type,
    status: 'open',
    tableId: input.tableId ?? null,
    ticketLabel: input.ticketLabel ?? null,
    vehicleNo: input.vehicleNo ?? null,
    bayNo: input.bayNo ?? null,
    phoneSnapshot: phone,
    addressSnapshot: input.addressSnapshot ?? null,
    customerName,
    customerId,
    // waiterId is set by whoever sends the first KOT, not at creation.
    createdBy: input.createdBy,
    openedAt: now(),
  }).run()
  return getOrder(id)
}

export function addItems(orderId: string, lines: NewLine[], employeeId: string, batchRef?: string) {
  requireEmployee(employeeId)
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'settled' || order.status === 'void') {
    throw conflict('Order is settled and can no longer be edited. Start a new order.')
  }

  for (const l of lines) {
    const item = db.select().from(s.items).where(eq(s.items.id, l.itemId)).get()
    if (!item) throw notFound(`item ${l.itemId}`)
    db.insert(s.orderItems).values({
      id: newId(),
      orderId,
      itemId: item.id,
      // Snapshots: a later price change must never rewrite this order.
      nameSnapshot: item.name,
      unitPriceSnapshot: item.price,
      qty: l.qty,
      modifiersJson: JSON.stringify(l.modifiers ?? []),
      note: l.note ?? null,
      status: 'new',
      batchRef: batchRef ?? null,
      createdBy: employeeId,
    }).run()
  }

  db.update(s.orders).set({ dirtySincePrint: true }).where(eq(s.orders.id, orderId)).run()
  recalculate(orderId)
  return getOrder(orderId)
}

/** Recompute totals from lines + settings. Voided lines never count. */
export function recalculate(orderId: string) {
  const cfg = getSettings()
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw new Error('order not found')

  const lines = db
    .select()
    .from(s.orderItems)
    .where(and(eq(s.orderItems.orderId, orderId), ne(s.orderItems.status, 'void')))
    .all()

  const calcLines: CalcLine[] = lines.map((l) => ({
    qty: l.qty,
    unitPrice: l.unitPriceSnapshot,
    modifierDeltas: (JSON.parse(l.modifiersJson) as { priceDelta: number }[]).map((m) => m.priceDelta),
  }))

  const result = calculate(
    calcLines,
    { type: order.discountType, value: order.discountValue },
    {
      taxRate: cfg.taxRateBp / 100,
      priceIncludesTax: cfg.priceIncludesTax,
      serviceChargePct: cfg.serviceChargeBp / 100,
      currencyDecimals: cfg.currencyDecimals,
    },
  )

  db.update(s.orders).set({
    subtotal: result.subtotal,
    discountAmount: result.discountAmount,
    serviceCharge: result.serviceCharge,
    taxAmount: result.tax,
    total: result.total,
  }).where(eq(s.orders.id, orderId)).run()

  return result
}

/**
 * Send unsent lines to the kitchens.
 *
 * Returns as soon as the database transaction commits. Printing happens after,
 * on the queue — the waiter's tablet is never blocked by a slow printer.
 *
 * `suppressKot` covers the already-served case: the lines are marked sent so
 * they never queue, but no ticket is created and the kitchen receives nothing.
 */
export function sendToKitchen(orderId: string, employeeId: string, suppressKot = false) {
  const cfg = getSettings()
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'settled' || order.status === 'void') {
    throw conflict('Order is settled and can no longer be edited. Start a new order.')
  }

  const employee = requireEmployee(employeeId)
  if (suppressKot && !employee.canSaveWithoutKot) {
    throw forbidden(`${employee.name} is not permitted to save an order without a KOT.`)
  }

  const unsent = db
    .select()
    .from(s.orderItems)
    .where(and(eq(s.orderItems.orderId, orderId), eq(s.orderItems.status, 'new')))
    .all()
  if (unsent.length === 0) return { tickets: [], suppressed: suppressKot }

  // Resolve each line's kitchen through its category.
  const routable = unsent.map((l) => {
    const item = db.select().from(s.items).where(eq(s.items.id, l.itemId)).get()!
    const cat = db.select().from(s.categories).where(eq(s.categories.id, item.categoryId)).get()!
    const mods = JSON.parse(l.modifiersJson) as { name: string }[]
    return {
      id: l.id,
      kitchenId: cat.kitchenId,
      qty: l.qty,
      name: l.nameSnapshot,
      note: l.note,
      modifiers: mods.map((m) => m.name),
    }
  })

  // The default kitchen is the fallback for a line whose category has none —
  // routeToKitchens reads it as `line.kitchenId ?? defaultKitchenId`. Demanding
  // it even when every line is already routed blocks the most ordinary setup
  // there is: one kitchen, every category pointing at it. As a plain Error it
  // also reached the tablet as a 500 "Something went wrong", which names neither
  // the cause nor the one field that fixes it.
  const unrouted = routable.filter((l) => !l.kitchenId)
  if (unrouted.length > 0 && !cfg.defaultKitchenId) {
    const names = [...new Set(unrouted.map((l) => l.name))].join(', ')
    throw conflict(
      `No kitchen to send ${names} to. Give that category a kitchen, or set a default kitchen under Setup.`,
    )
  }
  const groups = routeToKitchens(routable, cfg.defaultKitchenId ?? '')

  const existingSeqs = db
    .select({ seq: s.kotTickets.seq })
    .from(s.kotTickets)
    .where(eq(s.kotTickets.orderId, orderId))
    .all()
    .map((r) => r.seq)
  const seq = nextKotSeq(existingSeqs)
  const kind = kotKindForSeq(seq)

  const waiterName = employee.name
  const tableLabel = order.tableId
    ? (() => {
        const t = db.select().from(s.tables).where(eq(s.tables.id, order.tableId!)).get()
        if (!t) return null
        const a = db.select().from(s.areas).where(eq(s.areas.id, t.areaId)).get()
        return a ? `${t.name} - ${a.name}` : t.name
      })()
    : order.vehicleNo ?? order.phoneSnapshot ?? null

  const created: { kitchenId: string; ticketId: string | null }[] = []

  raw.transaction(() => {
    // First sender owns the order. Later rounds by other waiters are allowed
    // and recorded per line, but the credit stays with the owner.
    if (!order.waiterId) {
      db.update(s.orders).set({ waiterId: employeeId }).where(eq(s.orders.id, orderId)).run()
    }

    for (const g of groups) {
      if (suppressKot) {
        created.push({ kitchenId: g.kitchenId, ticketId: null })
        continue
      }
      const kitchen = db.select().from(s.kitchens).where(eq(s.kitchens.id, g.kitchenId)).get()!
      const ticketId = newId()
      const payload: KotPayload = {
        kitchenName: kitchen.name,
        orderNo: order.orderNo,
        seq,
        kind,
        orderType: order.type,
        tableLabel,
        ticketLabel: order.ticketLabel,
        waiterName,
        at: stamp(),
        lines: g.lines.map((l) => ({ qty: l.qty, name: l.name, note: l.note, modifiers: l.modifiers })),
      }
      db.insert(s.kotTickets).values({
        id: ticketId, orderId, kitchenId: g.kitchenId, seq, kind,
        linesJson: JSON.stringify(payload.lines),
      }).run()
      db.insert(s.printJobs).values({
        id: newId(), printerId: kitchen.printerId, kind: 'kot',
        payloadJson: JSON.stringify(payload), refId: ticketId,
      }).run()
      created.push({ kitchenId: g.kitchenId, ticketId })
    }

    db.update(s.orderItems)
      .set({ status: 'sent', kotSuppressed: suppressKot })
      .where(inArray(s.orderItems.id, unsent.map((l) => l.id)))
      .run()
  })()

  recalculate(orderId)

  // Fire printers after the commit. Never inside the transaction.
  if (!suppressKot) {
    for (const g of groups) {
      const kitchen = db.select().from(s.kitchens).where(eq(s.kitchens.id, g.kitchenId)).get()!
      printQueue.kick(kitchen.printerId)
    }
  }

  return { tickets: created, seq, kind, suppressed: suppressKot }
}

export function getOrder(orderId: string) {
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) return null
  const lines = db.select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId)).all()
  return { ...order, lines: lines.map((l) => ({ ...l, modifiers: JSON.parse(l.modifiersJson) })) }
}

/**
 * Open orders WITH their lines.
 *
 * The tablet's order list shows an item count, so returning bare order rows
 * made `order.lines` undefined on a client whose type said otherwise. One
 * branch never has enough open orders for the extra rows to matter, and a
 * single shape beats two that can drift apart.
 */
export function listOpenOrders() {
  const orders = db.select().from(s.orders).where(inArray(s.orders.status, ['open', 'billed'])).all()
  if (orders.length === 0) return []

  const lines = db
    .select()
    .from(s.orderItems)
    .where(inArray(s.orderItems.orderId, orders.map((o) => o.id)))
    .all()

  const byOrder = new Map<string, typeof lines>()
  for (const l of lines) {
    const arr = byOrder.get(l.orderId) ?? []
    arr.push(l)
    byOrder.set(l.orderId, arr)
  }

  return orders.map((o) => ({
    ...o,
    lines: (byOrder.get(o.id) ?? []).map((l) => ({ ...l, modifiers: JSON.parse(l.modifiersJson) })),
  }))
}

/**
 * Settled and cancelled orders in a range, newest first, WITH lines and
 * payments — what the counter needs to find a bill again and reprint it.
 *
 * A settled order is placed by when it was paid, a cancelled one by when it
 * was opened (it was never paid). Search happens on the client: one business
 * day is a few hundred orders at most.
 */
export function listClosedOrders(range: { from: Date; to: Date }) {
  const orders = db
    .select()
    .from(s.orders)
    .where(or(
      and(eq(s.orders.status, 'settled'), gte(s.orders.settledAt, range.from), lt(s.orders.settledAt, range.to)),
      and(eq(s.orders.status, 'void'), gte(s.orders.openedAt, range.from), lt(s.orders.openedAt, range.to)),
    ))
    .orderBy(desc(s.orders.settledAt), desc(s.orders.openedAt))
    .all()
  if (orders.length === 0) return []
  const ids = orders.map((o) => o.id)

  const lines = db.select().from(s.orderItems).where(inArray(s.orderItems.orderId, ids)).all()
  const payments = db
    .select({
      orderId: s.payments.orderId, amount: s.payments.amount, refNo: s.payments.refNo,
      mode: s.paymentModes.name,
    })
    .from(s.payments)
    .innerJoin(s.paymentModes, eq(s.payments.paymentModeId, s.paymentModes.id))
    .where(inArray(s.payments.orderId, ids))
    .all()

  const group = <T extends { orderId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) m.set(r.orderId, [...(m.get(r.orderId) ?? []), r])
    return m
  }
  const linesBy = group(lines)
  const paymentsBy = group(payments)

  return orders.map((o) => ({
    ...o,
    lines: (linesBy.get(o.id) ?? []).map((l) => ({ ...l, modifiers: JSON.parse(l.modifiersJson) })),
    payments: (paymentsBy.get(o.id) ?? []).map(({ orderId: _o, ...p }) => p),
  }))
}

/** Admin reassigns service credit. `createdBy` is never touched. */
export function setWaiter(orderId: string, waiterId: string, employeeId: string) {
  requireEmployee(employeeId)
  requireEmployee(waiterId)
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'settled' || order.status === 'void') throw conflict('Order is locked.')
  const waiter = db.select().from(s.employees).where(eq(s.employees.id, waiterId)).get()
  if (!waiter) throw notFound('waiter')

  db.update(s.orders).set({ waiterId }).where(eq(s.orders.id, orderId)).run()
  audit(employeeId, 'order.reassign_waiter', 'order', orderId, {
    from: order.waiterId, to: waiterId, toName: waiter.name,
  })
  return getOrder(orderId)
}

/**
 * Move an order to another table. Guests get moved constantly, so this is used
 * far more than you would expect.
 *
 * The server allows any active table — two parties on one table is legitimate,
 * and the tablet is what restricts the choice to free ones.
 */
export function setTable(orderId: string, tableId: string | null, employeeId: string) {
  requireEmployee(employeeId)
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  if (order.status === 'settled' || order.status === 'void') throw conflict('Order is locked.')
  if (order.type !== 'dine_in') throw conflict('Only a dine-in order sits at a table.')

  let toName: string | null = null
  if (tableId) {
    const table = db.select().from(s.tables).where(eq(s.tables.id, tableId)).get()
    if (!table || !table.active) throw notFound('table')
    toName = table.name
  }

  db.update(s.orders).set({ tableId }).where(eq(s.orders.id, orderId)).run()
  audit(employeeId, 'order.change_table', 'order', orderId, {
    from: order.tableId, to: tableId, toName,
  })
  return getOrder(orderId)
}

/**
 * Create (or extend) an order, add its lines and send them — in one call.
 *
 * The tablet queues exactly this payload when the counter is unreachable and
 * replays it on reconnect. Because `batchRef` is client-generated and checked
 * here first, a retry that arrives after a request actually succeeded is a
 * no-op rather than a duplicate round to the kitchen.
 */
export function submitOrder(input: {
  batchRef: string
  orderId?: string | null
  type: 'dine_in' | 'takeaway' | 'car' | 'delivery'
  tableId?: string | null
  ticketLabel?: string | null
  vehicleNo?: string | null
  bayNo?: string | null
  phoneSnapshot?: string | null
  addressSnapshot?: string | null
  customerName?: string | null
  lines: NewLine[]
  employeeId: string
  suppressKot?: boolean
}) {
  const already = db
    .select({ orderId: s.orderItems.orderId })
    .from(s.orderItems)
    .where(eq(s.orderItems.batchRef, input.batchRef))
    .get()
  if (already) {
    return { order: getOrder(already.orderId), result: null, duplicate: true as const }
  }

  const orderId =
    input.orderId ??
    createOrder({
      type: input.type,
      tableId: input.tableId ?? null,
      ticketLabel: input.ticketLabel ?? null,
      vehicleNo: input.vehicleNo ?? null,
      bayNo: input.bayNo ?? null,
      phoneSnapshot: input.phoneSnapshot ?? null,
      addressSnapshot: input.addressSnapshot ?? null,
      customerName: input.customerName ?? null,
      createdBy: input.employeeId,
    })!.id

  addItems(orderId, input.lines, input.employeeId, input.batchRef)
  const result = sendToKitchen(orderId, input.employeeId, input.suppressKot ?? false)
  return { order: getOrder(orderId), result, duplicate: false as const }
}
