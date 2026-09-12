import { and, count, eq } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { z } from 'zod'
import { audit } from '../audit.js'
import { db } from '../db.js'
import { conflict, notFound } from '../errors.js'

const s = schema

/* ─────────────────────────── field schemas ─────────────────────────── */

const name = z.string().trim().min(1, 'Name is required').max(80)
const sort = z.number().int().min(0).default(0)
const active = z.boolean().default(true)
const money = z.number().int().min(0, 'Cannot be negative')

/** Dotted quad. A hostname would not survive a router that rewrites DNS. */
const ipv4 = z.string().trim().regex(
  /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/,
  'Enter an IP address like 192.168.1.15',
)

const printer = z.object({
  name,
  ip: ipv4,
  port: z.number().int().min(1).max(65535).default(9100),
  /** 58mm ≈ 32 characters, 80mm ≈ 48. Drives the ESC/POS renderer. */
  width: z.union([z.literal(58), z.literal(80)]).default(80),
  enabled: z.boolean().default(true),
})

const kitchen = z.object({ name, printerId: z.string().min(1), active })
const counter = z.object({ name, printerId: z.string().min(1), active })
const category = z.object({ name, kitchenId: z.string().min(1).nullable().default(null), sort, active })
const item = z.object({
  categoryId: z.string().min(1),
  name,
  price: money,
  isAvailable: z.boolean().default(true),
  sort,
  active,
})
const area = z.object({ name, sort, active })
const table = z.object({
  areaId: z.string().min(1),
  name,
  seats: z.number().int().min(1).max(40).default(4),
  sort,
  active,
})
const employee = z.object({
  name,
  role: z.enum(['admin', 'waiter']),
  canDiscount: z.boolean().default(false),
  maxDiscountPercent: z.number().int().min(0).max(100).default(0),
  canSaveWithoutKot: z.boolean().default(false),
  active,
})
const paymentMode = z.object({
  name,
  type: z.enum(['cash', 'card', 'wallet', 'credit', 'online']),
  merchantName: z.string().trim().max(60).nullable().default(null),
  terminalId: z.string().trim().max(60).nullable().default(null),
  requiresRef: z.boolean().default(false),
  opensCashDrawer: z.boolean().default(false),
  countsInCashClosing: z.boolean().default(false),
  sort,
  active,
})
const expenseCategory = z.object({ name, active })
const modifierGroup = z.object({
  name,
  minSelect: z.number().int().min(0).max(20).default(0),
  maxSelect: z.number().int().min(1).max(20).default(1),
  sort,
  active,
}).refine((g) => g.minSelect <= g.maxSelect, {
  message: 'Minimum cannot be more than the maximum',
  path: ['minSelect'],
})
const modifier = z.object({
  groupId: z.string().min(1),
  name,
  priceDelta: z.number().int().default(0),
  sort,
  active,
})

/* ─────────────────────────── registry ─────────────────────────── */

/**
 * The registry is heterogeneous on purpose — one code path for twelve tables.
 * Drizzle's per-table types cannot express that, so the boundary is typed
 * loosely here and precisely at the zod schemas, which is where bad input
 * actually needs catching.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type MasterTable = any
type Row = Record<string, unknown> & { id: string; name?: string }

/**
 * Counts rows that still point at a record, so deactivating something in use
 * fails with a sentence the admin can act on rather than breaking service later.
 */
type Guard = (id: string) => string | null

const countWhere = (table: MasterTable, where: unknown): number =>
  (db.select({ n: count() }).from(table).where(where as never).get()?.n ?? 0)

const guards: Record<string, Guard> = {
  printers: (id) => {
    const k = countWhere(s.kitchens, and(eq(s.kitchens.printerId, id), eq(s.kitchens.active, true)))
    const c = countWhere(s.counters, and(eq(s.counters.printerId, id), eq(s.counters.active, true)))
    if (k + c === 0) return null
    const parts = [k ? `${k} kitchen(s)` : null, c ? `${c} counter(s)` : null].filter(Boolean)
    return `${parts.join(' and ')} still print to this printer.`
  },
  kitchens: (id) => {
    const settings = db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()
    if (settings?.defaultKitchenId === id) {
      return 'This is the default kitchen. Choose another default first, or unassigned categories would have nowhere to print.'
    }
    const n = countWhere(s.categories, and(eq(s.categories.kitchenId, id), eq(s.categories.active, true)))
    return n ? `${n} categor(y/ies) still print to this kitchen.` : null
  },
  counters: (id) => {
    const open = db.select().from(s.shifts).where(eq(s.shifts.counterId, id)).all()
      .filter((sh) => sh.closedAt == null).length
    return open ? 'A shift is still open on this counter.' : null
  },
  categories: (id) => {
    const n = countWhere(s.items, and(eq(s.items.categoryId, id), eq(s.items.active, true)))
    return n ? `${n} item(s) are still in this category.` : null
  },
  areas: (id) => {
    const n = countWhere(s.tables, and(eq(s.tables.areaId, id), eq(s.tables.active, true)))
    return n ? `${n} table(s) are still in this area.` : null
  },
  modifierGroups: (id) => {
    const n = countWhere(s.modifiers, and(eq(s.modifiers.groupId, id), eq(s.modifiers.active, true)))
    return n ? `${n} modifier(s) still belong to this group.` : null
  },
}

interface Entry {
  table: MasterTable
  schema: z.ZodTypeAny
  /** Names must be unique within a master so staff can tell rows apart. */
  uniqueName?: boolean
  guard?: Guard
}

export const MASTERS: Record<string, Entry> = {
  printers: { table: s.printers as never, schema: printer, uniqueName: true, guard: guards.printers },
  kitchens: { table: s.kitchens, schema: kitchen, uniqueName: true, guard: guards.kitchens },
  counters: { table: s.counters, schema: counter, uniqueName: true, guard: guards.counters },
  categories: { table: s.categories, schema: category, uniqueName: true, guard: guards.categories },
  items: { table: s.items, schema: item },
  areas: { table: s.areas as never, schema: area, uniqueName: true, guard: guards.areas },
  tables: { table: s.tables, schema: table },
  employees: { table: s.employees as never, schema: employee, uniqueName: true },
  paymentModes: { table: s.paymentModes as never, schema: paymentMode, uniqueName: true },
  expenseCategories: { table: s.expenseCategories as never, schema: expenseCategory, uniqueName: true },
  modifierGroups: { table: s.modifierGroups as never, schema: modifierGroup, uniqueName: true },
  modifiers: { table: s.modifiers, schema: modifier },
}

function entry(name: string): Entry {
  const e = MASTERS[name]
  if (!e) throw notFound(`master '${name}'`)
  return e
}

/** Zod messages are written for the admin to read, so surface the first one. */
function parse(e: Entry, body: unknown, partial: boolean) {
  const schemaToUse = partial && e.schema instanceof z.ZodObject ? e.schema.partial() : e.schema
  const result = schemaToUse.safeParse(body)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw conflict(issue?.message ?? 'That does not look right.')
  }
  return result.data as Record<string, unknown>
}

function assertNameFree(e: Entry, name: unknown, excludeId?: string) {
  if (!e.uniqueName || typeof name !== 'string') return
  const rows = db.select().from(e.table).all() as Row[]
  const clash = rows.find((r) => r.name?.toLowerCase() === name.toLowerCase() && r.id !== excludeId)
  if (clash) throw conflict(`"${name}" already exists.`)
}

export function listMaster(name: string) {
  entry(name)
  return db.select().from(entry(name).table).all()
}

export function createMaster(name: string, body: unknown, employeeId: string) {
  const e = entry(name)
  const data = parse(e, body, false)
  assertNameFree(e, data.name)

  const id = newId()
  db.insert(e.table).values({ id, ...data }).run()
  audit(employeeId, 'master.create', name, id, data)
  return db.select().from(e.table).where(eq(e.table.id, id)).get()
}

export function updateMaster(name: string, id: string, body: unknown, employeeId: string) {
  const e = entry(name)
  const before = db.select().from(e.table).where(eq(e.table.id, id)).get()
  if (!before) throw notFound(name)

  const data = parse(e, body, true)
  assertNameFree(e, data.name, id)

  // Turning a record off is what the guards protect; turning one on is safe.
  if (data.active === false && e.guard) {
    const blocked = e.guard(id)
    if (blocked) throw conflict(blocked)
  }

  db.update(e.table).set(data).where(eq(e.table.id, id)).run()
  audit(employeeId, 'master.update', name, id, data)
  return db.select().from(e.table).where(eq(e.table.id, id)).get()
}

/**
 * Deactivate, never delete.
 *
 * Old orders snapshot item names and prices, but categories, kitchens and
 * employees are still referenced by id from historical rows — removing one
 * would leave last month's reports unable to name it.
 */
export function deactivateMaster(name: string, id: string, employeeId: string) {
  const e = entry(name)
  const row = db.select().from(e.table).where(eq(e.table.id, id)).get()
  if (!row) throw notFound(name)

  if (e.guard) {
    const blocked = e.guard(id)
    if (blocked) throw conflict(blocked)
  }

  const field = name === 'printers' ? 'enabled' : 'active'
  db.update(e.table).set({ [field]: false }).where(eq(e.table.id, id)).run()
  audit(employeeId, 'master.deactivate', name, id, null)
  return { deactivated: true }
}

/* ─────────────────────────── settings ─────────────────────────── */

const settingsSchema = z.object({
  businessName: z.string().trim().max(80),
  addressLine: z.string().trim().max(120),
  phone: z.string().trim().max(40),
  receiptFooter: z.string().trim().max(120),
  countryCode: z.string().trim().length(2),
  currencyCode: z.string().trim().length(3),
  currencyDisplay: z.string().trim().min(1).max(8),
  currencyDecimals: z.number().int().min(0).max(3),
  taxName: z.string().trim().min(1).max(12),
  /** Basis points: 5% is 500, so the rate stays an integer like the money. */
  taxRateBp: z.number().int().min(0).max(10_000),
  taxNumberLabel: z.string().trim().min(1).max(12),
  taxNumberValue: z.string().trim().max(40),
  priceIncludesTax: z.boolean(),
  serviceChargeBp: z.number().int().min(0).max(10_000),
  invoicePrefix: z.string().trim().max(10),
  businessDayStartHour: z.number().int().min(0).max(23),
  defaultKitchenId: z.string().min(1).nullable(),
  requirePinOnAction: z.boolean(),
}).partial()

export function updateSettings(body: unknown, employeeId: string) {
  const result = settingsSchema.safeParse(body)
  if (!result.success) {
    throw conflict(result.error.issues[0]?.message ?? 'That does not look right.')
  }
  const data = result.data

  // Invoice numbering is append-only; letting it be edited would create gaps.
  if ('invoiceNextNo' in (body as object)) {
    throw conflict('The invoice number cannot be changed — it must stay gapless.')
  }
  if (data.defaultKitchenId) {
    const k = db.select().from(s.kitchens).where(eq(s.kitchens.id, data.defaultKitchenId)).get()
    if (!k || !k.active) throw conflict('Choose an active kitchen as the default.')
  }

  db.update(s.settings).set(data).where(eq(s.settings.id, 'singleton')).run()
  audit(employeeId, 'settings.update', 'settings', 'singleton', data)
  return db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()
}

/** Bulk add, for laying out a section of tables in one go: A1…A12. */
export function bulkTables(
  input: { areaId: string; prefix: string; from: number; to: number; seats: number },
  employeeId: string,
) {
  const { areaId, prefix, from, to, seats } = input
  if (to < from) throw conflict('The last number is before the first.')
  if (to - from > 99) throw conflict('Add at most 100 tables at a time.')
  const areaRow = db.select().from(s.areas).where(eq(s.areas.id, areaId)).get()
  if (!areaRow) throw notFound('area')

  const existing = new Set(
    db.select().from(s.tables).where(eq(s.tables.areaId, areaId)).all().map((t) => t.name.toLowerCase()),
  )
  const rows = []
  for (let n = from; n <= to; n++) {
    const label = `${prefix}${n}`
    if (existing.has(label.toLowerCase())) continue
    rows.push({ id: newId(), areaId, name: label, seats, sort: n })
  }
  if (rows.length > 0) db.insert(s.tables).values(rows).run()
  audit(employeeId, 'master.bulk_tables', 'tables', areaId, { added: rows.length, prefix, from, to })
  return { added: rows.length, skipped: to - from + 1 - rows.length }
}
