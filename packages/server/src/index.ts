import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { eq } from 'drizzle-orm'
import Fastify from 'fastify'
import { newId, schema } from '@pos/shared'
import { db, migrateDb } from './db.js'
import { seedMinimal } from './seed-minimal.js'
import { AppError, conflict, forbidden, notFound, unpaired } from './errors.js'
import { printerHealth } from './printer.js'
import { listUsbPrinters } from './printer-usb.js'
import { printQueue } from './queue.js'
import { applyDiscount, paidSoFar, printBill, settle } from './services/billing.js'
import { addItems, createOrder, getOrder, listClosedOrders, listOpenOrders, sendToKitchen, setTable, setWaiter, submitOrder } from './services/orders.js'
import { findCustomerByPhone, searchCustomers } from './services/customers.js'
import { changeOwnPin, confirmPin, login, setPin } from './services/auth.js'
import {
  authenticateDevice, cancelPairingCode, createPairingCode, hubAddresses, listDevices, pairDevice, revokeDevice,
} from './services/devices.js'
import { grantTrial, installLicence, licenceStatus, type TrialUnit } from './services/licence.js'
import { clearEverything, clearGroup, inventory, type GroupId } from './services/reset.js'
import {
  createAdmin, listAdmins, requireSuperadmin, resetAdminPin, setAdminActive,
  setSuperadminPassword, setupSuperadmin, superadminConfigured, superadminLogin, superadminLogout,
} from './services/superadmin.js'
import { createExpense, listExpenses } from './services/expenses.js'
import { backupStatus, runBackup, setBackupDirectory, startDailyBackups } from './services/backups.js'
import { discardPrintJob, listPrintJobs, printJobCounts, retryPrintJob, testDrawer } from './services/print-jobs.js'
import {
  MASTERS, bulkTables, createMaster, deactivateMaster, listItemModifierGroups, listMaster,
  setItemModifierGroups, updateMaster, updateSettings,
} from './services/masters.js'
import {
  categoryWise, discountsAndVoids, employeeWise, itemWise, orderTypeWise,
  paymentModeWise, resolveRange, salesSummary, taxSummary, toCsv, type RangePreset,
} from './services/reports.js'
import { importMenu, type MenuImportRow } from './services/menu-import.js'
import { canOpenShift, closeShift, openShift, openShiftIdFor, zReport } from './services/shifts.js'
import { removeUnsentLine, voidLine, voidOrder } from './services/voids.js'

/** Set by the access hook when a paired tablet made the request. */
declare module 'fastify' {
  interface FastifyRequest {
    device?: { id: string; name: string } | null
  }
}

const s = schema

/**
 * Build the hub server without starting it.
 *
 * Electron imports this and runs it in-process, so nothing here may execute on
 * import — the desktop shell needs to set the database path first.
 */
export async function createServer(opts: { pretty?: boolean; logger?: boolean } = {}) {
const app = Fastify({
  logger: opts.logger === false ? false : opts.pretty === false ? true : { transport: { target: 'pino-pretty' } },
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

/* ───────────────────────────── access ───────────────────────────── */

/**
 * Who may call what.
 *
 *   counter PC  — requests from this machine (loopback). The admin UI runs here,
 *                 in Electron or behind the Vite proxy. Full access; the cashier
 *                 is still identified by PIN sign-in for attribution.
 *   tablet      — any other address, and only with a valid device token. Limited
 *                 to taking orders: no settle, void, discount, masters, reports.
 *   anyone      — health check and the pairing exchange itself.
 *
 * A presented token always wins, even from loopback: an emulator reached over
 * `adb reverse` arrives as 127.0.0.1 and must still be scoped as a tablet.
 *
 * Loopback is read from the socket, never from X-Forwarded-For — trustProxy is
 * off, so a LAN device cannot claim to be the counter.
 */
const PUBLIC_ROUTES = new Set(['GET /api/health', 'POST /api/devices/pair'])

const TABLET_ROUTES = new Set([
  'GET /api/bootstrap',
  'GET /api/devices/me',
  'GET /api/orders/open',
  'GET /api/orders/:id',
  'POST /api/orders',
  'POST /api/orders/submit',
  'POST /api/orders/:id/items',
  'DELETE /api/orders/:id/items/:lineId',
  'POST /api/orders/:id/send',
  'POST /api/orders/:id/table',
  'POST /api/orders/:id/bill',
  // Delivery: phone first, then the name and saved addresses fill in.
  'GET /api/customers/lookup',
  'GET /ws',
])

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

app.addHook('onRequest', async (req) => {
  const route = `${req.method} ${req.routeOptions.url ?? req.url.split('?')[0]}`
  if (PUBLIC_ROUTES.has(route)) return

  const header = req.headers['x-device-token']
  // WebSocket clients cannot always set headers, so /ws also accepts ?token=.
  const token = (Array.isArray(header) ? header[0] : header) ??
    (req.query as { token?: string } | undefined)?.token

  if (token) {
    const device = authenticateDevice(token)
    if (!device) throw unpaired('This tablet has been unpaired. Pair it again from the counter PC.')
    if (!TABLET_ROUTES.has(route)) throw forbidden('That can only be done at the counter.')
    req.device = device
    return
  }

  if (LOOPBACK.has(req.socket.remoteAddress ?? '')) return
  throw unpaired('This device is not paired with the counter. Pair it from the counter PC.')
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
  // Never ship the key or install id to a tablet — just enough for a banner.
  licence: (({ state, plan, daysLeft, msLeft, warning, expiresAt }) => ({ state, plan, daysLeft, msLeft, warning, expiresAt }))(licenceStatus()),
  settings: (({ licenceKey: _k, installId: _i, clockHighWater: _c, trialStartedAt: _t, trialEndsAt: _te, superadminHash: _h, ...rest }) => rest)(
    db.select().from(s.settings).get()!,
  ),
  areas: db.select().from(s.areas).where(eq(s.areas.active, true)).all(),
  tables: db.select().from(s.tables).where(eq(s.tables.active, true)).all(),
  categories: db.select().from(s.categories).where(eq(s.categories.active, true)).all(),
  items: db.select().from(s.items).where(eq(s.items.active, true)).all(),
  employees: db
    .select({
      id: s.employees.id, name: s.employees.name, role: s.employees.role,
      canSaveWithoutKot: s.employees.canSaveWithoutKot, canDiscount: s.employees.canDiscount,
    })
    .from(s.employees).where(eq(s.employees.active, true)).all()
    // Never ship the hash; just whether a PIN exists, so the sign-in screen can
    // explain why someone cannot be picked.
    .map((e) => ({
      ...e,
      hasPin: db.select({ h: s.employees.pinHash }).from(s.employees)
        .where(eq(s.employees.id, e.id)).get()?.h != null,
    })),
  counters: db.select().from(s.counters).where(eq(s.counters.active, true)).all(),
  paymentModes: db.select().from(s.paymentModes).where(eq(s.paymentModes.active, true)).all(),
  modifierGroups: db.select().from(s.modifierGroups).where(eq(s.modifierGroups.active, true)).all(),
  modifiers: db.select().from(s.modifiers).where(eq(s.modifiers.active, true)).all(),
  itemModifierGroups: db.select().from(s.itemModifierGroups).all(),
}))

/* ───────────────────────────── orders ───────────────────────────── */

app.get('/api/orders/open', async () => listOpenOrders())

/** Settled and cancelled bills, for finding and reprinting them at the counter. */
app.get('/api/orders/closed', async (req) => {
  const q = req.query as { preset?: RangePreset; from?: string; to?: string }
  const range = resolveRange({ preset: q.preset ?? 'today', from: q.from, to: q.to })
  return { range: { from: range.from, to: range.to, label: range.label }, orders: listClosedOrders(range) }
})

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

/* ───────────────────────────── customers ───────────────────────────── */

/** One customer per phone number. `customer` is null when the number is new. */
app.get('/api/customers/lookup', async (req) => {
  const { phone } = req.query as { phone?: string }
  return { customer: findCustomerByPhone(phone ?? '') }
})

app.get('/api/customers', async (req) => {
  const { q } = req.query as { q?: string }
  return { customers: searchCustomers(q ?? '') }
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
  // canOpen is false only when the licence has expired and nothing is left to
  // settle. The cashier UI then lets them into the app instead of trapping
  // them on the open-counter step.
  return { shiftId: id, open: id != null, canOpen: id == null && canOpenShift() }
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
  // No folder from the client: the Settings folder (or the default) is used.
  const result = closeShift(id, countedCash, employeeId, backupDir)
  broadcast('shift.closed', { shiftId: id })
  return result
})

/* ───────────────────────────── expenses ───────────────────────────── */

app.get('/api/expenses', async (req) => {
  const q = req.query as { preset?: RangePreset; from?: string; to?: string; categoryId?: string }
  const range = resolveRange({ preset: q.preset ?? 'today', from: q.from, to: q.to })
  return { range: { from: range.from, to: range.to, label: range.label }, expenses: listExpenses({ ...range, categoryId: q.categoryId }) }
})

app.post('/api/expenses', async (req) => {
  const expense = createExpense(req.body as Parameters<typeof createExpense>[0])
  broadcast('expense.created', { id: expense.id })
  return expense
})

/* ───────────────────────────── auth ───────────────────────────── */

/**
 * Counter sign-in. The tablet deliberately has no equivalent — see
 * docs/01-product-spec.md §6.6.
 */
app.post('/api/auth/login', async (req) => {
  const { employeeId, pin } = req.body as { employeeId: string; pin: string }
  return login(employeeId, pin)
})

/** Re-check before an admin screen opens; same lockout as sign-in. */
app.post('/api/auth/confirm', async (req) => {
  const { employeeId, pin, area } = (req.body ?? {}) as { employeeId: string; pin: string; area?: string }
  return confirmPin(employeeId, pin ?? '', area ?? 'admin')
})

app.post('/api/auth/pin', async (req) => {
  const { employeeId, pin, byEmployeeId } = req.body as
    { employeeId: string; pin: string; byEmployeeId: string }
  return setPin(employeeId, pin, byEmployeeId)
})

/** The signed-in admin replacing their own PIN; needs the current one. */
app.post('/api/auth/change-pin', async (req) => {
  const { employeeId, currentPin, newPin } = req.body as
    { employeeId: string; currentPin: string; newPin: string }
  return changeOwnPin(employeeId, currentPin ?? '', newPin ?? '')
})

/* ───────────────────────────── devices ───────────────────────────── */

/** Public: lets a tablet confirm it has found a hub before it has a token. */
app.get('/api/health', async () => ({
  ok: true,
  name: db.select({ n: s.settings.businessName }).from(s.settings).get()?.n ?? null,
}))

app.post('/api/devices/pair', async (req) => {
  const body = (req.body ?? {}) as { code: string; name?: string }
  const result = pairDevice(body, req.socket.remoteAddress ?? 'unknown')
  broadcast('device.paired', { deviceId: result.deviceId })
  return result
})

/** Tablet: confirms the stored token is still accepted. */
app.get('/api/devices/me', async (req) => req.device ?? null)

app.get('/api/devices', async () => ({ devices: listDevices(), addresses: hubAddresses() }))

app.post('/api/devices/code', async (req) => {
  const { employeeId } = req.body as { employeeId: string }
  return createPairingCode(employeeId)
})

app.delete('/api/devices/code', async () => {
  cancelPairingCode()
  return { cancelled: true }
})

app.delete('/api/devices/:id', async (req) => {
  const { id } = req.params as { id: string }
  const { employeeId } = (req.query ?? {}) as { employeeId: string }
  const result = revokeDevice(id, employeeId)
  broadcast('device.revoked', { deviceId: id })
  return result
})

/* ───────────────────────────── licence ───────────────────────────── */

app.get('/api/licence', async () => licenceStatus())

app.post('/api/licence', async (req) => {
  const { key, employeeId } = req.body as { key: string; employeeId: string }
  const status = installLicence(key, employeeId)
  broadcast('licence.changed', { state: status.state })
  return status
})

/* ───────────────────────────── superadmin ───────────────────────────── */

/**
 * The way back in when admin PINs are lost.
 *
 * None of these appear in TABLET_ROUTES, so a paired tablet gets 403 whatever
 * password it presents — the door only exists on the counter PC.
 */
const superadminToken = (req: { headers: Record<string, unknown> }) => {
  const h = req.headers['x-superadmin-token']
  return (Array.isArray(h) ? h[0] : h) as string | undefined
}

app.get('/api/superadmin/status', async () => ({ configured: superadminConfigured() }))

app.post('/api/superadmin/login', async (req) => {
  const { password } = req.body as { password: string }
  return superadminLogin(password ?? '', req.socket.remoteAddress ?? 'unknown')
})

app.post('/api/superadmin/setup', async (req) => {
  const { password } = (req.body ?? {}) as { password?: string }
  return setupSuperadmin(password ?? '')
})

app.post('/api/superadmin/logout', async (req) => superadminLogout(superadminToken(req)))

app.get('/api/superadmin/admins', async (req) => {
  requireSuperadmin(superadminToken(req))
  return listAdmins()
})

app.post('/api/superadmin/admins', async (req) => {
  requireSuperadmin(superadminToken(req))
  const { name, pin } = req.body as { name: string; pin: string }
  const admin = createAdmin({ name, pin })
  broadcast('master.changed', { entity: 'employees' })
  return admin
})

app.post('/api/superadmin/admins/:id/pin', async (req) => {
  requireSuperadmin(superadminToken(req))
  const { id } = req.params as { id: string }
  return resetAdminPin(id, (req.body as { pin: string }).pin)
})

app.post('/api/superadmin/admins/:id/active', async (req) => {
  requireSuperadmin(superadminToken(req))
  const { id } = req.params as { id: string }
  const result = setAdminActive(id, (req.body as { active: boolean }).active)
  broadcast('master.changed', { entity: 'employees' })
  return result
})

app.get('/api/superadmin/inventory', async (req) => {
  requireSuperadmin(superadminToken(req))
  return inventory()
})

app.post('/api/superadmin/clear/:group', async (req) => {
  requireSuperadmin(superadminToken(req))
  const { group } = req.params as { group: string }
  const result = group === 'all' ? clearEverything() : clearGroup(group as GroupId)
  broadcast('master.changed', { entity: group })
  return result
})

app.get('/api/superadmin/licence', async (req) => {
  requireSuperadmin(superadminToken(req))
  return licenceStatus()
})

app.post('/api/superadmin/trial', async (req) => {
  requireSuperadmin(superadminToken(req))
  const { value, unit } = req.body as { value: number; unit: TrialUnit }
  const status = grantTrial(value, unit)
  broadcast('licence.changed', { state: status.state })
  return status
})

app.post('/api/superadmin/licence', async (req) => {
  requireSuperadmin(superadminToken(req))
  const status = installLicence((req.body as { key: string }).key ?? '', null)
  broadcast('licence.changed', { state: status.state })
  return status
})

app.post('/api/superadmin/password', async (req) => {
  requireSuperadmin(superadminToken(req))
  return setSuperadminPassword((req.body as { password: string }).password ?? '')
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

/** The modifier groups an item asks for. The body replaces the whole set. */
app.get('/api/masters/items/:id/modifier-groups', async (req) =>
  ({ groupIds: listItemModifierGroups((req.params as { id: string }).id) }))

app.put('/api/masters/items/:id/modifier-groups', async (req) => {
  const { id } = req.params as { id: string }
  const { groupIds, employeeId } = (req.body ?? {}) as { groupIds?: string[]; employeeId: string }
  if (!Array.isArray(groupIds)) throw conflict('Send groupIds as a list.')
  const result = setItemModifierGroups(id, groupIds, employeeId)
  broadcast('master.changed', { entity: 'items' })
  return { groupIds: result }
})

app.post('/api/masters/tables/bulk', async (req) => {
  const { employeeId, ...body } = req.body as Parameters<typeof bulkTables>[0] & { employeeId: string }
  const result = bulkTables(body, employeeId)
  broadcast('master.changed', { entity: 'tables' })
  return result
})

/**
 * Spreadsheet import of categories + items. `dryRun: true` returns the plan
 * for the operator to check — above all which kitchen (and so which printer)
 * each new category's KOTs will go to — before anything is written.
 */
app.post('/api/masters/menu/import', async (req) => {
  const { rows, dryRun, employeeId } = (req.body ?? {}) as {
    rows: MenuImportRow[]; dryRun?: boolean; employeeId: string
  }
  if (!Array.isArray(rows)) throw conflict('Send the sheet as a list of rows.')
  const plan = importMenu(rows, { dryRun: dryRun !== false }, employeeId)
  if (plan.applied) {
    broadcast('master.changed', { entity: 'categories' })
    broadcast('master.changed', { entity: 'items' })
  }
  return plan
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
  'discounts-voids': ['amount'],
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
  // Discounts and voids are two lists; a spreadsheet wants one, with a column saying which.
  const list: Record<string, unknown>[] = kind === 'discounts-voids'
    ? (() => {
      const d = data as ReturnType<typeof discountsAndVoids>
      return [
        ...d.discounts.map((r) => ({ kind: 'discount', ...r })),
        ...d.voids.map((r) => ({ kind: 'void', ...r })),
      ]
    })()
    : Array.isArray(data) ? data : [data as Record<string, unknown>]
  const rows = list.map(flat)
  const csv = toCsv(rows, MONEY_KEYS[kind] ?? [], cfg.currencyDecimals)
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${kind}-${range.from.toISOString().slice(0, 10)}.csv"`)
    .send(csv)
})

/* ───────────────────────────── printers ───────────────────────────── */

app.get('/api/printers', async () => {
  const rows = db.select().from(s.printers).all()
  return Promise.all(rows.map(async (p) => {
    const { online, detail } = await printerHealth(p)
    return { ...p, online, statusDetail: detail }
  }))
})

/** Printers installed in Windows on this PC — the choices for a USB printer. */
app.get('/api/printers/system', async () => {
  try {
    return { printers: await listUsbPrinters(), error: null }
  } catch (e) {
    return { printers: [], error: e instanceof Error ? e.message : String(e) }
  }
})

app.post('/api/printers/:id/drawer', async (req) => {
  const { employeeId } = req.body as { employeeId: string }
  return testDrawer((req.params as { id: string }).id, employeeId)
})

app.post('/api/printers/:id/test', async (req) => {
  const { id } = req.params as { id: string }
  const printer = db.select().from(s.printers).where(eq(s.printers.id, id)).get()
  if (!printer) throw notFound('printer')
  db.insert(s.printJobs).values({
    id: newId(), printerId: printer.id, kind: 'test',
    payloadJson: JSON.stringify({
      printerName: printer.name, ip: printer.ip, port: printer.port,
      connection: printer.connection, systemName: printer.systemName,
      at: new Date().toLocaleString('en-GB'),
    }),
  }).run()
  printQueue.kick(printer.id)
  return { queued: true }
})

app.get('/api/print-jobs', async (req) => {
  const q = req.query as { status?: 'problems' | 'all'; limit?: string }
  return { jobs: listPrintJobs({ filter: q.status, limit: q.limit ? Number(q.limit) : undefined }), counts: printJobCounts() }
})

app.post('/api/print-jobs/:id/retry', async (req) => {
  const { employeeId } = req.body as { employeeId: string }
  const r = retryPrintJob((req.params as { id: string }).id, employeeId)
  broadcast('print.changed', r)
  return r
})

app.post('/api/print-jobs/:id/discard', async (req) => {
  const { employeeId } = req.body as { employeeId: string }
  const r = discardPrintJob((req.params as { id: string }).id, employeeId)
  broadcast('print.changed', r)
  return r
})

app.post('/api/print-jobs/retry', async (req) => {
  const { printerId } = (req.body ?? {}) as { printerId?: string }
  return { retried: await printQueue.retryFailed(printerId) }
})

/* ───────────────────────────── backups ───────────────────────────── */
// Counter PC only (not in TABLET_ROUTES): a backup is a copy of every sale.

app.get('/api/backups', async () => backupStatus())

app.post('/api/backups', async (req) => {
  const { employeeId } = req.body as { employeeId: string }
  const r = runBackup('manual', { employeeId })
  return { ...r, status: backupStatus() }
})

app.put('/api/backups/folder', async (req) => {
  const { dir, employeeId } = req.body as { dir: string | null; employeeId: string }
  return setBackupDirectory(dir, employeeId)
})

/* ───────────────────────────── admin UI ───────────────────────────── */

/**
 * Serve the built cashier UI from the hub itself.
 *
 * The Electron shell used to `loadFile()` it, but the UI calls relative `/api`
 * paths, which from `file://` resolve to `file:///api/...` and never reach the
 * hub. Loading it over http://127.0.0.1 fixes that, and puts every counter
 * request on loopback — which the access hook above treats as the counter PC.
 * A device on the shop wifi asking for `/` gets 401: the admin UI is not
 * reachable from the LAN at all.
 */
const uiDir = process.env.POS_UI_DIR
if (uiDir) {
  const root = path.resolve(uiDir)
  const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  }
  app.get('/*', async (req, reply) => {
    const rel = decodeURIComponent(req.url.split('?')[0] ?? '/')
    // Unknown API paths must 404, not quietly return the HTML shell.
    if (rel.startsWith('/api/') || rel === '/ws') throw notFound('route')
    const requested = path.resolve(root, `.${rel === '/' ? '/index.html' : rel}`)
    if (requested !== root && !requested.startsWith(root + path.sep)) throw notFound('file')
    // Hash routing means every non-file path is the app shell.
    const file = existsSync(requested) && statSync(requested).isFile() ? requested : path.join(root, 'index.html')
    reply.type(TYPES[path.extname(file)] ?? 'application/octet-stream')
    return reply.send(await readFile(file))
  })
}

  return app
}

/**
 * Start the hub. Binds 0.0.0.0 so tablets on the shop wifi can reach it —
 * which is also why Windows shows a firewall prompt on first run.
 */
export async function startServer(opts: { port?: number; pretty?: boolean } = {}) {
  migrateDb()
  // A fresh install has migrated tables and nothing in them: pricing throws
  // "settings missing" without the settings row. No admin is created — the
  // cashier UI opens on first-time setup, where the superadmin adds one.
  // seedMinimal is a no-op once a settings row exists, so this runs exactly once
  // in the life of an installation.
  seedMinimal()
  const app = await createServer(opts)
  const port = opts.port ?? Number(process.env.PORT ?? 4000)
  await app.listen({ port, host: '0.0.0.0' })

  // Anything left pending from a crash, or a printer that was off overnight.
  await printQueue.kickAll()
  // A shop that never closes its shift still gets a backup a day.
  startDailyBackups()
  return { app, port }
}
