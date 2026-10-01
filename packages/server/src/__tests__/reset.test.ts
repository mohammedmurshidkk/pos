import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(path.join(tmpdir(), 'pos-reset-'))
process.env.POS_DB = path.join(dir, 'test.db')
process.env.POS_BACKUP_DIR = dir
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb, raw } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const R = await import('../services/reset.js')
const S = await import('../services/superadmin.js')
const { createOrder, addItems, sendToKitchen } = await import('../services/orders.js')
const { eq } = await import('drizzle-orm')

const s = schema
const rows = (table: string) => (raw.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n
const group = (id: string) => R.inventory().find((g) => g.id === id)!
const settings = () => db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()!

/** A hub that has been used: masters set up and a few test orders taken. */
function seedUsed() {
  raw.prepare('pragma foreign_keys = OFF').run()
  for (const t of ['audit_log', 'print_jobs', 'kot_tickets', 'payments', 'order_items', 'orders',
                   'expenses', 'shifts', 'customer_addresses', 'customers', 'item_modifier_groups',
                   'modifiers', 'modifier_groups', 'items', 'categories', 'tables', 'areas',
                   'employees', 'counters', 'payment_modes', 'expense_categories', 'kitchens',
                   'printers', 'devices', 'settings']) {
    raw.prepare(`delete from ${t}`).run()
  }
  raw.prepare('pragma foreign_keys = ON').run()
  seed()
  const admin = db.select().from(s.employees).where(eq(s.employees.name, 'Fatima')).get()!
  const item = db.select().from(s.items).get()!
  const order = createOrder({ type: 'takeaway', createdBy: admin.id })!
  addItems(order.id, [{ itemId: item.id, qty: 2 }], admin.id)
  sendToKitchen(order.id, admin.id)
}

beforeEach(() => {
  migrateDb()
  seedUsed()
})

describe('what is on this hub', () => {
  it('lists every group with a count', () => {
    const inv = R.inventory()
    expect(inv.find((g) => g.id === 'printers')!.count).toBe(4)
    expect(inv.find((g) => g.id === 'kitchens')!.count).toBe(3)
    expect(inv.find((g) => g.id === 'sales')!.count).toBeGreaterThan(0)
  })
})

describe('clearing one group at a time', () => {
  it('refuses printers while kitchens still print through them', () => {
    expect(group('printers').blockedBy).toMatch(/Kitchens and Counters first/i)
    expect(() => R.clearGroup('printers')).toThrow(/print through these printers/i)
  })

  it('refuses kitchens while the menu still routes to them', () => {
    expect(() => R.clearGroup('kitchens')).toThrow(/Clear the Menu first/i)
  })

  it('refuses the menu while past orders reference its items', () => {
    expect(() => R.clearGroup('menu')).toThrow(/Sales and history first/i)
  })

  it('works in dependency order, all the way down to printers', () => {
    R.clearGroup('sales')
    R.clearGroup('menu')
    R.clearGroup('kitchens')
    R.clearGroup('devices')
    R.clearGroup('tills')
    expect(group('printers').blockedBy).toBeNull()
    expect(R.clearGroup('printers').rows).toBe(4)
    expect(rows('printers')).toBe(0)
  })

  it('clears the default kitchen setting with the kitchens', () => {
    R.clearGroup('sales')
    R.clearGroup('menu')
    expect(settings().defaultKitchenId).not.toBeNull()
    R.clearGroup('kitchens')
    expect(settings().defaultKitchenId).toBeNull()
  })

  it('restarts invoice numbering when test sales are cleared', () => {
    db.update(s.settings).set({ invoiceNextNo: 1042, orderNextNo: 37 }).where(eq(s.settings.id, 'singleton')).run()
    R.clearGroup('sales')
    expect(settings().invoiceNextNo).toBe(1)
    expect(settings().orderNextNo).toBe(1)
  })

  it('says so rather than pretending when a group is already empty', () => {
    R.clearGroup('devices')
    expect(() => R.clearGroup('devices')).toThrow(/already empty/i)
  })

  it('writes a backup before deleting anything', () => {
    const { backupPath, rows: n } = R.clearGroup('sales')
    expect(backupPath).toContain('before-clear-sales')
    expect(n).toBeGreaterThan(0)
  })
})

describe('clearing everything', () => {
  it('empties every table the shop filled in', () => {
    R.clearEverything()
    for (const t of ['printers', 'kitchens', 'counters', 'categories', 'items', 'areas',
                     'tables', 'employees', 'payment_modes', 'expense_categories',
                     'orders', 'order_items', 'payments', 'devices']) {
      expect(rows(t), t).toBe(0)
    }
  })

  it('keeps the licence, trial clock and superadmin password', () => {
    const before = settings()
    S.setSuperadminPassword('a good password')
    R.clearEverything()
    const after = settings()

    expect(after.installId).toBe(before.installId)
    expect(after.trialStartedAt?.getTime()).toBe(before.trialStartedAt?.getTime())
    expect(after.superadminHash).not.toBeNull()
    // The superadmin can still get back into the installation it just reset.
    expect(S.superadminLogin('a good password', '127.0.0.1').token).toBeTruthy()
  })

  it('resets the shop details and numbering', () => {
    R.clearEverything()
    const after = settings()
    expect(after.businessName).toBe('')
    expect(after.taxNumberValue).toBe('')
    expect(after.invoiceNextNo).toBe(1)
    expect(after.defaultKitchenId).toBeNull()
  })

  it('leaves nobody able to sign in — the superadmin adds the first admin', () => {
    R.clearEverything()
    expect(S.listAdmins()).toHaveLength(0)

    const created = S.createAdmin({ name: 'Murshid', pin: '1234' })
    expect(created.hasPin).toBe(true)
    expect(S.listAdmins()).toHaveLength(1)
  })

  it('ignores the dependency order that blocks single groups', () => {
    // Nothing is blocked: the whole graph goes at once, in the right order.
    expect(() => R.clearEverything()).not.toThrow()
    expect(R.inventory().every((g) => g.count === 0)).toBe(true)
  })

  it('writes a backup first', () => {
    expect(R.clearEverything().backupPath).toContain('before-clear-all')
  })
})

describe('a cleared hub can be handed to another shop', () => {
  it('leaves no readable trace of the old data on disk', () => {
    const name = db.select().from(s.items).get()!.name
    const file = process.env.POS_DB!
    // WAL mode: recent writes live in the -wal sidecar until a checkpoint, so
    // both files have to be clean, not just the main one.
    const onDisk = () => {
      const parts = [file, `${file}-wal`]
        .filter((f) => existsSync(f))
        .map((f) => readFileSync(f))
      return Buffer.concat(parts).includes(Buffer.from(name))
    }

    expect(onDisk()).toBe(true)
    R.clearEverything()
    // DELETE alone would leave this text sitting in freed pages.
    expect(onDisk()).toBe(false)
  })
})
