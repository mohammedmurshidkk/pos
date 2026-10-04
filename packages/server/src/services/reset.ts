import { eq } from 'drizzle-orm'
import { schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db, raw } from '../db.js'
import { runBackup } from './backups.js'
import { conflict, notFound } from '../errors.js'

const s = schema

/**
 * Clearing the installation — handing a tested hub over as a fresh one.
 *
 * Two things are never touched, because losing either would be unrecoverable
 * from inside the app: the **settings row's identity** (install id, licence,
 * trial clock, superadmin password) and nothing else. Everything a shop typed
 * in can go.
 *
 * Groups clear in dependency order. Foreign keys are ON, so a wrong order is a
 * SQLite error rather than corruption — the guards exist to explain the order
 * in words a person can act on instead.
 */

export type GroupId =
  | 'sales' | 'menu' | 'floor' | 'staff' | 'tills'
  | 'kitchens' | 'printers' | 'devices' | 'expenseCategories'

const count = (table: string): number =>
  (raw.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n

/**
 * Cleared, but not counted or shown.
 *
 * Clearing writes its own audit row, so counting the audit log would leave
 * "Sales and history: 1" immediately after emptying it — and would block
 * Employees forever, since that guard looks for history.
 */
const NOT_COUNTED = new Set(['audit_log'])
const countGroup = (tables: string[]) =>
  tables.filter((t) => !NOT_COUNTED.has(t)).reduce((n, t) => n + count(t), 0)

/** Audit rows that actually name an employee — those are the ones a DELETE trips on. */
const auditRowsNamingEmployees = () =>
  (raw.prepare('select count(*) as n from audit_log where employee_id is not null').get() as { n: number }).n

interface Group {
  id: GroupId
  label: string
  description: string
  tables: string[]
  /** Why this cannot be cleared yet, in the order a person should do it. */
  blockedBy: () => string | null
}

const GROUPS: Group[] = [
  {
    id: 'sales',
    label: 'Sales and history',
    description: 'Orders, kitchen tickets, payments, shifts, expenses, customers and the audit log.',
    // Children before parents: order_items and payments point at orders.
    tables: ['audit_log', 'print_jobs', 'kot_tickets', 'payments', 'order_items', 'orders',
             'expenses', 'shifts', 'customer_addresses', 'customers'],
    blockedBy: () => null,
  },
  {
    id: 'menu',
    label: 'Menu',
    description: 'Categories, items, modifier groups and modifiers.',
    tables: ['item_modifier_groups', 'modifiers', 'modifier_groups', 'items', 'categories'],
    blockedBy: () => count('order_items') > 0
      ? 'Clear Sales and history first — past order lines still point at these items.' : null,
  },
  {
    id: 'floor',
    label: 'Areas and tables',
    description: 'The floor plan.',
    tables: ['tables', 'areas'],
    blockedBy: () => count('orders') > 0
      ? 'Clear Sales and history first — past orders still point at these tables.' : null,
  },
  {
    id: 'staff',
    label: 'Employees',
    description: 'Waiters and admins. The superadmin password is not affected.',
    tables: ['employees'],
    blockedBy: () => (count('orders') + count('payments') + count('shifts') + count('expenses') + auditRowsNamingEmployees()) > 0
      ? 'Clear Sales and history first — it records who took and settled each order.' : null,
  },
  {
    id: 'tills',
    label: 'Counters and payment modes',
    description: 'Where invoices print and how customers pay.',
    tables: ['counters', 'payment_modes'],
    blockedBy: () => {
      if (count('devices') > 0) return 'Clear Paired tablets first — a tablet remembers which counter it prints to.'
      return (count('shifts') + count('payments') + count('orders')) > 0
        ? 'Clear Sales and history first — shifts and payments are recorded against a counter.' : null
    },
  },
  {
    id: 'kitchens',
    label: 'Kitchens',
    description: 'Prep points that KOTs print to.',
    tables: ['kitchens'],
    blockedBy: () => count('categories') > 0
      ? 'Clear the Menu first — categories decide which kitchen prints their tickets.' : null,
  },
  {
    id: 'printers',
    label: 'Printers',
    description: 'The physical printers.',
    tables: ['printers'],
    blockedBy: () => {
      const k = count('kitchens')
      const c = count('counters')
      if (k + c === 0) return null
      const parts = [k ? 'Kitchens' : null, c ? 'Counters' : null].filter(Boolean).join(' and ')
      return `Clear ${parts} first — they print through these printers.`
    },
  },
  {
    id: 'devices',
    label: 'Paired tablets',
    description: 'Every tablet will have to be paired again.',
    tables: ['devices'],
    blockedBy: () => null,
  },
  {
    id: 'expenseCategories',
    label: 'Expense categories',
    description: 'What an expense can be filed under.',
    tables: ['expense_categories'],
    blockedBy: () => count('expenses') > 0
      ? 'Clear Sales and history first — recorded expenses use these categories.' : null,
  },
]

/** Every table, most dependent first. Used by the full reset. */
const FULL_ORDER = [
  'audit_log', 'print_jobs', 'kot_tickets', 'payments', 'order_items', 'orders',
  'expenses', 'shifts', 'customer_addresses', 'customers',
  'item_modifier_groups', 'modifiers', 'modifier_groups', 'items', 'categories',
  'tables', 'areas',
  'devices', 'counters', 'payment_modes',
  'employees', 'kitchens', 'printers', 'expense_categories',
]

/** A copy of the database before anything is deleted. Cheap insurance. */
function backupBeforeClearing(what: string): string | null {
  try {
    return runBackup('before_clear', { label: what }).path
  } catch {
    // A missing backup folder must not stop a deliberate reset.
    return null
  }
}

export function inventory() {
  return GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    description: g.description,
    count: countGroup(g.tables),
    blockedBy: g.blockedBy(),
  }))
}

function wipe(tables: string[]) {
  for (const table of tables) raw.prepare(`delete from ${table}`).run()
}

export function clearGroup(id: GroupId) {
  const group = GROUPS.find((g) => g.id === id)
  if (!group) throw notFound(`group '${id}'`)

  const blocked = group.blockedBy()
  if (blocked) throw conflict(blocked)

  const before = countGroup(group.tables)
  if (before === 0) throw conflict(`${group.label} is already empty.`)

  const backupPath = backupBeforeClearing(id)
  raw.transaction(() => {
    // Before, not after: settings.default_kitchen_id is a foreign key, so the
    // DELETE itself fails while it still points at one of these rows.
    if (id === 'kitchens') {
      db.update(s.settings).set({ defaultKitchenId: null }).where(eq(s.settings.id, 'singleton')).run()
    }
    wipe(group.tables)
    // Test orders should not leave the first real invoice at number 40.
    if (id === 'sales') {
      db.update(s.settings).set({ invoiceNextNo: 1, orderNextNo: 1 }).where(eq(s.settings.id, 'singleton')).run()
    }
  })()

  audit(null, 'superadmin.clear_group', 'settings', id, { rows: before, backupPath })
  return { cleared: group.label, rows: before, backupPath }
}

/**
 * Factory reset: everything the shop entered, in one go.
 *
 * Deliberately keeps the settings ROW (its identity columns carry the licence,
 * the trial clock and the superadmin password) while resetting every field the
 * shop filled in. Afterwards nobody can sign in — which is the intended state:
 * the superadmin creates the first admin, and that admin builds the rest.
 */
export function clearEverything() {
  const backupPath = backupBeforeClearing('all')
  const rows = GROUPS.reduce((n, g) => n + countGroup(g.tables), 0)

  raw.transaction(() => {
    // Foreign keys are enforced inside the transaction too, so this is one
    // explicit order rather than the group order — devices reference counters,
    // and the default kitchen setting has to let go before kitchens are deleted.
    db.update(s.settings).set({ defaultKitchenId: null }).where(eq(s.settings.id, 'singleton')).run()
    wipe(FULL_ORDER)

    db.update(s.settings).set({
      businessName: '', addressLine: '', phone: '', logoPath: null, receiptFooter: '',
      countryCode: 'AE', currencyCode: 'AED', currencyDisplay: 'AED', currencyDecimals: 2,
      taxName: 'VAT', taxRateBp: 500, taxNumberLabel: 'TRN', taxNumberValue: '',
      priceIncludesTax: true, serviceChargeBp: 0,
      invoicePrefix: 'INV-', invoiceNextNo: 1, orderNextNo: 1,
      businessDayStartHour: 0, defaultKitchenId: null, requirePinOnAction: false,
      // installId, trialStartedAt, trialEndsAt, licenceKey, clockHighWater and superadminHash
      // are deliberately absent — losing them would cost the shop its licence
      // and lock the superadmin out of the installation it just reset.
    }).where(eq(s.settings.id, 'singleton')).run()
  })()

  audit(null, 'superadmin.clear_all', 'settings', 'singleton', { rows, backupPath })

  // DELETE frees pages without overwriting them, so the old shop's menu and
  // sales stay readable inside the file. VACUUM rebuilds it; the checkpoint
  // folds the write-ahead log in, which would otherwise still hold the rows.
  // Outside the transaction above — SQLite refuses to VACUUM inside one.
  raw.exec('vacuum')
  raw.pragma('wal_checkpoint(TRUNCATE)')

  return { cleared: 'Everything', rows, backupPath }
}
