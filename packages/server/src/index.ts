import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { eq } from 'drizzle-orm'
import Fastify from 'fastify'
import { newId, schema } from '@pos/shared'
import { db, migrateDb } from './db.js'
import { AppError, notFound } from './errors.js'
import { pingPrinter } from './printer.js'
import { printQueue } from './queue.js'
import { applyDiscount, paidSoFar, printBill, settle } from './services/billing.js'
import { addItems, createOrder, getOrder, listOpenOrders, sendToKitchen, setWaiter } from './services/orders.js'
import { removeUnsentLine, voidLine, voidOrder } from './services/voids.js'

const s = schema
migrateDb()

const app = Fastify({ logger: { transport: { target: 'pino-pretty' } } })
await app.register(cors, { origin: true })
await app.register(websocket)

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

app.post('/api/orders/:id/waiter', async (req) => {
  const { id } = req.params as { id: string }
  const { waiterId, employeeId } = req.body as { waiterId: string; employeeId: string }
  const order = setWaiter(id, waiterId, employeeId)
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

const port = Number(process.env.PORT ?? 4000)
await app.listen({ port, host: '0.0.0.0' })

// Anything left pending from a crash, or a printer that was off overnight.
await printQueue.kickAll()
