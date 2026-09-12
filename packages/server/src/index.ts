import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { eq } from 'drizzle-orm'
import Fastify from 'fastify'
import { newId, schema } from '@pos/shared'
import { db, migrateDb } from './db.js'
import { AppError, conflict, notFound } from './errors.js'
import { pingPrinter } from './printer.js'
import { printQueue } from './queue.js'
import { applyDiscount, paidSoFar, printBill, settle } from './services/billing.js'
import { addItems, createOrder, getOrder, listOpenOrders, sendToKitchen, setTable, setWaiter, submitOrder } from './services/orders.js'
import { createExpense, listExpenses } from './services/expenses.js'
import {
  MASTERS, bulkTables, createMaster, deactivateMaster, listMaster, updateMaster, updateSettings,
} from './services/masters.js'
import {
  categoryWise, discountsAndVoids, employeeWise, itemWise, orderTypeWise,
  paymentModeWise, resolveRange, salesSummary, taxSummary, toCsv, type RangePreset,
} from './services/reports.js'
import { closeShift, openShift, openShiftIdFor, zReport } from './services/shifts.js'
import { removeUnsentLine, voidLine, voidOrder } from './services/voids.js'

const s = schema

/**
 * Build the hub server without starting it.
 *
 * Electron imports this and runs it in-process, so nothing here may execute on
 * import — the desktop shell needs to set the database path first.
 */
export async function createServer(opts: { pretty?: boolean } = {}) {
const app = Fastify({
  logger: opts.pretty === false ? true : { transport: { target: 'pino-pretty' } },
})
await app.register(cors, { origin: true })
await app.register(websocket)

/**
 * A body-less DELETE that still carries `content-type: application/json` is
 * ordinary browser behaviour, but Fastify's default parser rejects the empty
 * body with a 500 — which swallowed the guard message behind a generic error.
 */
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const text = String(body ?? '').trim()
  if (text === '') return done(null, undefined)
  try {
    done(null, JSON.parse(text))
  } catch {
    done(conflict('The request body was not valid JSON.'), undefined)
  }
})

/**
 * Known errors reach the tablet as actionable 4xx with a stable code.
 * Anything else is a real bug and stays a 500.
 */
app.setErrorHandler((err, _req, reply) => {
  if (err instanceof AppError) {
    return reply.code(err.status).send({ error: err.code, message: err.message })
  }
  app.log.error(err)
  return reply.code(500).send({ error: 'internal', message: 'Something went wrong.' })
})

/* ───────────────────────────── live push ───────────────────────────── */

const sockets = new Set<{ send: (s: string) => void }>()

/** Tablets and the cashier screen both listen here. */
function broadcast(type: string, payload: unknown) {
  const msg = JSON.stringify({ type, payload, at: Date.now() })
  for (const sock of sockets) {
    try { sock.send(msg) } catch { sockets.delete(sock) }
  }
}

app.get('/ws', { websocket: true }, (sock) => {
  sockets.add(sock)
  sock.send(JSON.stringify({ type: 'hello', payload: { ok: true } }))
  sock.on('close', () => sockets.delete(sock))
})

// Print failures surface on the cashier PC, never on the waiter's tablet.
printQueue.onEvent((e) => {
  app.log.warn(e, 'print')
  broadcast(e.type, e.payload)
})

/* ───────────────────────────── bootstrap ───────────────────────────── */

app.get('/api/bootstrap', async () => ({
  settings: db.select().from(s.settings).get(),
  areas: db.select().from(s.areas).where(eq(s.areas.active, true)).all(),
  tables: db.select().from(s.tables).where(eq(s.tables.active, true)).all(),
  categories: db.select().from(s.categories).where(eq(s.categories.active, true)).all(),
  items: db.select().from(s.items).where(eq(s.items.active, true)).all(),
  employees: db
    .select({ id: s.employees.id, name: s.employees.name, role: s.employees.role, canSaveWithoutKot: s.employees.canSaveWithoutKot, canDiscount: s.employees.canDiscount })
    .from(s.employees).where(eq(s.employees.active, true)).all(),
  counters: db.select().from(s.counters).where(eq(s.counters.active, true)).all(),
  paymentModes: db.select().from(s.paymentModes).where(eq(s.paymentModes.active, true)).all(),
  modifierGroups: db.select().from(s.modifierGroups).where(eq(s.modifierGroups.active, true)).all(),
  modifiers: db.select().from(s.modifiers).where(eq(s.modifiers.active, true)).all(),
  itemModifierGroups: db.select().from(s.itemModifierGroups).all(),
}))

/* ───────────────────────────── orders ───────────────────────────── */

app.get('/api/orders/open', async () => listOpenOrders())

app.get('/api/orders/:id', async (req) => {
  const order = getOrder((req.params as { id: string }).id)
  if (!order) throw notFound('order')
  return order
})

app.post('/api/orders', async (req) => {
  const order = createOrder(req.body as Parameters<typeof createOrder>[0])
  broadcast('order.created', { orderId: order?.id })
  return order
})

app.post('/api/orders/:id/items', async (req) => {
  const { id } = req.params as { id: string }
  const body = req.body as { lines: Parameters<typeof addItems>[1]; employeeId: string }
  const order = addItems(id, body.lines, body.employeeId)
  broadcast('order.updated', { orderId: id })
  return order
})

app.delete('/api/orders/:id/items/:lineId', async (req) => {
  const { id, lineId } = req.params as { id: string; lineId: string }
  const totals = removeUnsentLine(id, lineId)
  broadcast('order.updated', { orderId: id })
  return totals
})

/** employeeId is whoever the tablet's picker returned. */
app.post('/api/orders/:id/send', async (req) => {
  const { id } = req.params as { id: string }
  const { employeeId, suppressKot } = req.body as { employeeId: string; suppressKot?: boolean }
  const result = sendToKitchen(id, employeeId, suppressKot ?? false)
  broadcast('order.sent', { orderId: id, ...result })
  return result
})

/** One idempotent call: create + add lines + send. What the tablet queues. */
app.post('/api/orders/submit', async (req) => {
  const result = submitOrder(req.body as Parameters<typeof submitOrder>[0])
  if (!result.duplicate) broadcast('order.sent', { orderId: result.order?.id })
  return result
})

app.post('/api/orders/:id/waiter', async (req) => {
  const { id } = req.params as { id: string }
  const { waiterId, employeeId } = req.body as { waiterId: string; employeeId: string }
  const order = setWaiter(id, waiterId, employeeId)
  broadcast('order.updated', { orderId: id })
  return order
})

app.post('/api/orders/:id/table', async (req) => {
  const { id } = req.params as { id: string }
  const { tableId, employeeId } = req.body as { tableId: string | null; employeeId: string }
  const order = setTable(id, tableId, employeeId)
  broadcast('order.updated', { orderId: id })
  return order
})

app.post('/api/orders/:id/discount', async (req) => {
  const { id } = req.params as { id: string }
  const result = applyDiscount(id, req.body as Parameters<typeof applyDiscount>[1])
  broadcast('order.updated', { orderId: id })
  return result
})

/* ───────────────────────────── billing ───────────────────────────── */

app.post('/api/orders/:id/bill', async (req) => {
  const { id } = req.params as { id: string }
  const { employeeId, counterId } = req.body as { employeeId: string; counterId: string }
  const result = printBill(id, employeeId, counterId)
  broadcast('order.billed', { orderId: id, ...result })
  return result
})

app.post('/api/orders/:id/settle', async (req) => {
  const { id } = req.params as { id: string }
  const result = settle(id, req.body as Parameters<typeof settle>[1])
  broadcast('order.settled', { orderId: id, ...result })
  return result
})

app.get('/api/orders/:id/paid', async (req) => ({ paid: paidSoFar((req.params as { id: string }).id) }))

/* ───────────────────────────── voids ───────────────────────────── */

app.post('/api/orders/:id/items/:lineId/void', async (req) => {
  const { id, lineId } = req.params as { id: string; lineId: string }
  const { reason, employeeId } = req.body as { reason: string; employeeId: string }
  const result = voidLine(id, lineId, reason, employeeId)
  broadcast('order.updated', { orderId: id })
  return result
})

app.post('/api/orders/:id/void', async (req) => {
  const { id } = req.params as { id: string }
  const { reason, employeeId } = req.body as { reason: string; employeeId: string }
  const result = voidOrder(id, reason, employeeId)
  broadcast('order.voided', { orderId: id })
  return result
})

/* ───────────────────────────── shifts ───────────────────────────── */

app.get('/api/shifts/current', async (req) => {
  const { counterId } = req.query as { counterId: string }
  const id = openShiftIdFor(counterId)
  return { shiftId: id, open: id != null }
})

app.post('/api/shifts/open', async (req) => {
  const shift = openShift(req.body as Parameters<typeof openShift>[0])
  broadcast('shift.opened', { shiftId: shift.id })
  return shift
})

/** Preview before closing — the cashier counts against this. */
app.get('/api/shifts/:id/z-report', async (req) => zReport((req.params as { id: string }).id))

app.post('/api/shifts/:id/close', async (req) => {
  const { id } = req.params as { id: string }
  const { countedCash, employeeId, backupDir } = req.body as {
    countedCash: number; employeeId: string; backupDir?: string
  }
  const result = closeShift(id, countedCash, employeeId, backupDir ?? process.env.POS_BACKUP_DIR)
  broadcast('shift.closed', { shiftId: id })
  return result
})

/* ───────────────────────────── expenses ───────────────────────────── */

app.get('/api/expenses', async () => listExpenses())

app.post('/api/expenses', async (req) => {
  const expense = createExpense(req.body as Parameters<typeof createExpense>[0])
  broadcast('expense.created', { id: expense.id })
  return expense
})

/* ───────────────────────────── masters ───────────────────────────── */

/**
 * One generic surface for twelve masters. Every write carries `employeeId` so
 * the audit log can answer "who changed the price of this?".
 */
app.get('/api/masters', async () => ({ entities: Object.keys(MASTERS) }))

app.get('/api/masters/:entity', async (req) =>
  listMaster((req.params as { entity: string }).entity))

app.post('/api/masters/:entity', async (req) => {
  const { entity } = req.params as { entity: string }
  const { employeeId, ...body } = req.body as Record<string, unknown> & { employeeId: string }
  const row = createMaster(entity, body, employeeId)
  broadcast('master.changed', { entity })
  return row
})

app.patch('/api/masters/:entity/:id', async (req) => {
  const { entity, id } = req.params as { entity: string; id: string }
  const { employeeId, ...body } = req.body as Record<string, unknown> & { employeeId: string }
  const row = updateMaster(entity, id, body, employeeId)
  broadcast('master.changed', { entity })
  return row
})

app.delete('/api/masters/:entity/:id', async (req) => {
  const { entity, id } = req.params as { entity: string; id: string }
  const { employeeId } = (req.query ?? {}) as { employeeId: string }
  const result = deactivateMaster(entity, id, employeeId)
  broadcast('master.changed', { entity })
  return result
})

app.post('/api/masters/tables/bulk', async (req) => {
  const { employeeId, ...body } = req.body as Parameters<typeof bulkTables>[0] & { employeeId: string }
  const result = bulkTables(body, employeeId)
  broadcast('master.changed', { entity: 'tables' })
  return result
})

app.patch('/api/settings', async (req) => {
  const { employeeId, ...body } = req.body as Record<string, unknown> & { employeeId: string }
  const row = updateSettings(body, employeeId)
  broadcast('settings.changed', {})
  return row
})

/* ───────────────────────────── reports ───────────────────────────── */

/** Money columns per report, so CSV exports decimals a spreadsheet can sum. */
const MONEY_KEYS: Record<string, string[]> = {
  summary: ['grossSales', 'discounts', 'serviceCharge', 'net', 'tax', 'total', 'averageTicket'],
  items: ['gross'],
  categories: ['gross'],
  employees: ['total', 'averageTicket'],
  'payment-modes': ['total'],
  'order-types': ['total'],
  tax: ['net', 'tax', 'total'],
}

const REPORTS = {
  summary: salesSummary,
  items: itemWise,
  categories: categoryWise,
  employees: employeeWise,
  'payment-modes': paymentModeWise,
  'order-types': orderTypeWise,
  'discounts-voids': discountsAndVoids,
  tax: taxSummary,
} as const

app.get('/api/reports/:kind', async (req, reply) => {
  const { kind } = req.params as { kind: keyof typeof REPORTS }
  const q = req.query as { preset?: RangePreset; from?: string; to?: string; format?: string }
  const fn = REPORTS[kind]
  if (!fn) throw notFound(`report '${kind}'`)

  const range = resolveRange({ preset: q.preset ?? 'today', from: q.from, to: q.to })
  const data = fn(range)

  if (q.format !== 'csv') return { range: { ...range, label: range.label }, data }

  const cfg = db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()!
  // Drop nested duplicates that only exist for the JSON consumers.
  const flat = (r: Record<string, unknown>) => {
    const { invoiceRange: _drop, range: _range, ...rest } = r
    return rest
  }
  const rows = (Array.isArray(data) ? data : [data as Record<string, unknown>]).map((r) =>
    flat(r as Record<string, unknown>),
  )
  const csv = toCsv(rows, MONEY_KEYS[kind] ?? [], cfg.currencyDecimals)
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${kind}-${range.from.toISOString().slice(0, 10)}.csv"`)
    .send(csv)
})

/* ───────────────────────────── printers ───────────────────────────── */

app.get('/api/printers', async () => {
  const rows = db.select().from(s.printers).all()
  return Promise.all(rows.map(async (p) => ({ ...p, online: await pingPrinter({ ip: p.ip, port: p.port }) })))
})

app.post('/api/printers/:id/test', async (req) => {
  const { id } = req.params as { id: string }
  const printer = db.select().from(s.printers).where(eq(s.printers.id, id)).get()
  if (!printer) throw notFound('printer')
  db.insert(s.printJobs).values({
    id: newId(), printerId: printer.id, kind: 'test',
    payloadJson: JSON.stringify({
      printerName: printer.name, ip: printer.ip, port: printer.port,
      at: new Date().toLocaleString('en-GB'),
    }),
  }).run()
  printQueue.kick(printer.id)
  return { queued: true }
})

app.get('/api/print-jobs', async () => db.select().from(s.printJobs).all())

app.post('/api/print-jobs/retry', async (req) => {
  const { printerId } = (req.body ?? {}) as { printerId?: string }
  return { retried: await printQueue.retryFailed(printerId) }
})

  return app
}

/**
 * Start the hub. Binds 0.0.0.0 so tablets on the shop wifi can reach it —
 * which is also why Windows shows a firewall prompt on first run.
 */
export async function startServer(opts: { port?: number; pretty?: boolean } = {}) {
  migrateDb()
  const app = await createServer(opts)
  const port = opts.port ?? Number(process.env.PORT ?? 4000)
  await app.listen({ port, host: '0.0.0.0' })

  // Anything left pending from a crash, or a printer that was off overnight.
  await printQueue.kickAll()
  return { app, port }
}
