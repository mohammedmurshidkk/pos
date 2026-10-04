import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

process.env.POS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'pos-master-')), 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const M = await import('../services/masters.js')
const { eq } = await import('drizzle-orm')

const s = schema
let admin = ''
const byName = <T extends { name: string }>(rows: T[], n: string) => rows.find((r) => r.name === n)!

beforeAll(() => {
  migrateDb()
  seed()
  admin = db.select().from(s.employees).where(eq(s.employees.name, 'Fatima')).get()!.id
})

describe('validation', () => {
  it('rejects a printer address that is not an IP', () => {
    expect(() => M.createMaster('printers', { name: 'Bad', ip: 'kitchen-pc' }, admin))
      .toThrow(/IP address like/i)
  })

  it('rejects an empty name', () => {
    expect(() => M.createMaster('areas', { name: '   ' }, admin)).toThrow(/name is required/i)
  })

  it('rejects a negative price', () => {
    const cat = db.select().from(s.categories).get()!
    expect(() => M.createMaster('items', { categoryId: cat.id, name: 'Free lunch', price: -100 }, admin))
      .toThrow(/negative/i)
  })

  it('rejects a modifier group whose minimum exceeds its maximum', () => {
    expect(() => M.createMaster('modifierGroups', { name: 'Impossible', minSelect: 3, maxSelect: 1 }, admin))
      .toThrow(/minimum cannot be more/i)
  })

  it('rejects a discount cap over 100 percent', () => {
    expect(() => M.createMaster('employees', { name: 'Generous', role: 'admin', maxDiscountPercent: 150 }, admin))
      .toThrow()
  })

  it('rejects a duplicate name in the same master', () => {
    M.createMaster('areas', { name: 'Rooftop' }, admin)
    expect(() => M.createMaster('areas', { name: 'rooftop' }, admin)).toThrow(/already exists/i)
  })
})

describe('create and update', () => {
  it('creates a printer with sensible defaults', () => {
    const p = M.createMaster('printers', { name: 'Grill Printer', ip: '192.168.1.40' }, admin) as
      { id: string; port: number; width: number; enabled: boolean }
    expect(p.port).toBe(9100)
    expect(p.width).toBe(80)
    expect(p.enabled).toBe(true)
  })

  it('updates only the fields given', () => {
    const printers = M.listMaster('printers') as { id: string; name: string; ip: string; port: number }[]
    const p = byName(printers, 'Grill Printer')
    const updated = M.updateMaster('printers', p.id, { ip: '192.168.1.41' }, admin) as
      { name: string; ip: string; port: number }
    expect(updated.ip).toBe('192.168.1.41')
    expect(updated.name).toBe('Grill Printer')  // untouched
    expect(updated.port).toBe(9100)
  })

  it('records every change against the person who made it', () => {
    const log = db.select().from(s.auditLog).all()
    expect(log.some((l) => l.action === 'master.create' && l.entity === 'printers')).toBe(true)
    expect(log.every((l) => l.employeeId === admin)).toBe(true)
  })
})

describe('guards on deactivation', () => {
  it('refuses to disable a printer a kitchen still prints to', () => {
    const printers = M.listMaster('printers') as { id: string; name: string }[]
    const arabic = byName(printers, 'Arabic Kitchen')
    expect(() => M.deactivateMaster('printers', arabic.id, admin))
      .toThrow(/kitchen\(s\) still print/i)
  })

  it('refuses to disable the default kitchen', () => {
    const settings = db.select().from(s.settings).get()!
    expect(() => M.deactivateMaster('kitchens', settings.defaultKitchenId!, admin))
      .toThrow(/default kitchen/i)
  })

  it('refuses to disable a kitchen that categories still route to', () => {
    const kitchens = M.listMaster('kitchens') as { id: string; name: string }[]
    expect(() => M.deactivateMaster('kitchens', byName(kitchens, 'Chinese Kitchen').id, admin))
      .toThrow(/categor/i)
  })

  it('refuses to disable a category that still has items', () => {
    const cats = M.listMaster('categories') as { id: string; name: string }[]
    expect(() => M.deactivateMaster('categories', byName(cats, 'Noodles').id, admin))
      .toThrow(/item\(s\) are still/i)
  })

  it('refuses to disable an area that still has tables', () => {
    const areas = M.listMaster('areas') as { id: string; name: string }[]
    expect(() => M.deactivateMaster('areas', byName(areas, 'Terrace').id, admin))
      .toThrow(/table\(s\) are still/i)
  })

  it('allows disabling something nothing depends on', () => {
    const areas = M.listMaster('areas') as { id: string; name: string }[]
    expect(M.deactivateMaster('areas', byName(areas, 'Rooftop').id, admin)).toEqual({ deactivated: true })
  })

  it('deactivates rather than deletes, so history can still name it', () => {
    const rows = M.listMaster('areas') as { name: string; active: boolean }[]
    expect(byName(rows, 'Rooftop').active).toBe(false)
  })

  it('lets a record be switched back on without checking guards', () => {
    const areas = M.listMaster('areas') as { id: string; name: string }[]
    const back = M.updateMaster('areas', byName(areas, 'Rooftop').id, { active: true }, admin) as
      { active: boolean }
    expect(back.active).toBe(true)
  })
})

describe('settings', () => {
  it('updates tax configuration', () => {
    const out = M.updateSettings({ taxRateBp: 750, taxName: 'GST' }, admin) as
      { taxRateBp: number; taxName: string }
    expect(out.taxRateBp).toBe(750)
    expect(out.taxName).toBe('GST')
    M.updateSettings({ taxRateBp: 500, taxName: 'VAT' }, admin)
  })

  it('refuses to move the invoice counter — it must stay gapless', () => {
    expect(() => M.updateSettings({ invoiceNextNo: 5000 }, admin)).toThrow(/gapless/i)
  })

  it('refuses a default kitchen that is not active', () => {
    expect(() => M.updateSettings({ defaultKitchenId: 'nope' }, admin)).toThrow(/active kitchen/i)
  })
})

describe('payment mode type decides the cash handling', () => {
  type PM = { id: string; opensCashDrawer: boolean; countsInCashClosing: boolean; requiresRef: boolean; merchantName: string | null }

  it('a cash mode always counts at closing; opening the drawer is the shop\'s choice', () => {
    const pm = M.createMaster('paymentModes', {
      name: 'Cash 2', type: 'cash', opensCashDrawer: false, countsInCashClosing: false,
      requiresRef: true, merchantName: 'X',
    }, admin) as PM
    expect(pm).toMatchObject({ opensCashDrawer: false, countsInCashClosing: true, requiresRef: false, merchantName: null })
    expect((M.updateMaster('paymentModes', pm.id, { opensCashDrawer: true }, admin) as PM).opensCashDrawer).toBe(true)
  })

  it('nothing but cash counts as cash; a card may still open the drawer', () => {
    const pm = M.createMaster('paymentModes', {
      name: 'Card 3', type: 'card', opensCashDrawer: true, countsInCashClosing: true,
    }, admin) as PM
    expect(pm).toMatchObject({ opensCashDrawer: true, countsInCashClosing: false })
  })

  it('changing the type on edit follows, and an edit without a type keeps the rule', () => {
    const pm = M.createMaster('paymentModes', { name: 'Wallet 1', type: 'wallet' }, admin) as PM
    expect((M.updateMaster('paymentModes', pm.id, { type: 'cash' }, admin) as PM).countsInCashClosing).toBe(true)
    // Only the name changes: still cash, still counted.
    expect((M.updateMaster('paymentModes', pm.id, { name: 'Petty cash', countsInCashClosing: false }, admin) as PM)
      .countsInCashClosing).toBe(true)
  })
})

describe('bulk tables', () => {
  it('lays out a numbered run in one go', () => {
    const areas = M.listMaster('areas') as { id: string; name: string }[]
    const terrace = byName(areas, 'Terrace')
    const result = M.bulkTables({ areaId: terrace.id, prefix: 'T', from: 10, to: 14, seats: 2 }, admin)
    expect(result.added).toBe(5)
  })

  it('skips names that already exist rather than duplicating a table', () => {
    const areas = M.listMaster('areas') as { id: string; name: string }[]
    const terrace = byName(areas, 'Terrace')
    const result = M.bulkTables({ areaId: terrace.id, prefix: 'T', from: 12, to: 16, seats: 2 }, admin)
    expect(result.added).toBe(2)   // T15, T16
    expect(result.skipped).toBe(3) // T12, T13, T14 already there
  })

  it('rejects a backwards range', () => {
    const areas = M.listMaster('areas') as { id: string; name: string }[]
    expect(() => M.bulkTables({ areaId: byName(areas, 'Terrace').id, prefix: 'T', from: 9, to: 2, seats: 4 }, admin))
      .toThrow(/before the first/i)
  })
})

describe('item modifier groups', () => {
  it('links groups to an item in the order given, replacing the old set', () => {
    const cat = db.select().from(s.categories).get()!
    const item = M.createMaster('items', { categoryId: cat.id, name: 'Shawarma Plate', price: 2500 }, admin) as { id: string }
    const groups = M.listMaster('modifierGroups') as { id: string; name: string }[]
    const spice = byName(groups, 'Spice Level').id
    const addons = byName(groups, 'Add-ons').id

    expect(M.listItemModifierGroups(item.id)).toEqual([])
    expect(M.setItemModifierGroups(item.id, [addons, spice], admin)).toEqual([addons, spice])
    expect(M.setItemModifierGroups(item.id, [spice], admin)).toEqual([spice])
    expect(M.setItemModifierGroups(item.id, [], admin)).toEqual([])
  })

  it('refuses a group that does not exist', () => {
    const item = db.select().from(s.items).get()!
    expect(() => M.setItemModifierGroups(item.id, ['nope'], admin)).toThrow(/modifier group/i)
  })
})
