import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

process.env.POS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'pos-import-')), 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const { importMenu, parsePrice } = await import('../services/menu-import.js')
const { eq, and } = await import('drizzle-orm')

const s = schema
let admin = ''

beforeAll(() => {
  migrateDb()
  seed()
  admin = db.select().from(s.employees).where(eq(s.employees.name, 'Fatima')).get()!.id
})

const run = (rows: Parameters<typeof importMenu>[0], dryRun = false) =>
  importMenu(rows, { dryRun }, admin)

const categoryNamed = (name: string) =>
  db.select().from(s.categories).all().find((c) => c.name === name)

const itemIn = (categoryName: string, itemName: string) => {
  const cat = categoryNamed(categoryName)
  if (!cat) return undefined
  return db.select().from(s.items).where(eq(s.items.categoryId, cat.id)).all()
    .find((i) => i.name === itemName)
}

/* ─────────────────────────── price parsing ─────────────────────────── */

describe('parsePrice', () => {
  it('converts a decimal price to minor units', () => {
    expect(parsePrice('30.00', 2)).toEqual({ minor: 3000 })
    expect(parsePrice('25.50', 2)).toEqual({ minor: 2550 })
    expect(parsePrice(15, 2)).toEqual({ minor: 1500 })
  })

  it('survives the float values that round badly', () => {
    // 1.1 * 100 is 110.00000000000001 in IEEE 754; truncation would give 109.
    expect(parsePrice('1.1', 2)).toEqual({ minor: 110 })
    expect(parsePrice('8.7', 2)).toEqual({ minor: 870 })
    expect(parsePrice('0.29', 2)).toEqual({ minor: 29 })
  })

  it('honours a 3-decimal currency', () => {
    expect(parsePrice('2.500', 3)).toEqual({ minor: 2500 })
  })

  it('rejects more decimal places than the currency has', () => {
    // Rounding this to 30.01 would price the dish at something nobody typed.
    expect(parsePrice('30.005', 2)).toEqual({ error: expect.stringMatching(/decimal places/i) })
  })

  it('rejects text, blanks and negatives', () => {
    expect(parsePrice('twelve', 2)).toEqual({ error: expect.stringMatching(/not a number/i) })
    expect(parsePrice('', 2)).toEqual({ error: expect.stringMatching(/empty/i) })
    expect(parsePrice('-5.00', 2)).toEqual({ error: expect.stringMatching(/not a number/i) })
  })

  it('accepts a thousands separator', () => {
    expect(parsePrice('1,250.00', 2)).toEqual({ minor: 125000 })
  })
})

/* ─────────────────────────── dry run ─────────────────────────── */

describe('dry run', () => {
  it('reports the plan and writes nothing', () => {
    const before = db.select().from(s.items).all().length
    const plan = run([{ category: 'Dry Run Cat', item: 'Ghost', price: '10.00' }], true)

    expect(plan.applied).toBe(false)
    expect(plan.categoriesToCreate).toEqual([{ name: 'Dry Run Cat', kitchen: null }])
    expect(plan.itemsToCreate).toHaveLength(1)
    expect(categoryNamed('Dry Run Cat')).toBeUndefined()
    expect(db.select().from(s.items).all()).toHaveLength(before)
  })
})

/* ─────────────────────────── applying ─────────────────────────── */

describe('import', () => {
  it('creates categories and items', () => {
    const plan = run([
      { category: 'Grills', item: 'Peri Peri', price: '30.00' },
      { category: 'Grills', item: 'Garlic Chicken', price: '32.50' },
      { category: 'Juices', item: 'Mango', price: '15.00' },
    ])

    expect(plan.applied).toBe(true)
    expect(plan.errors).toEqual([])
    expect(plan.categoriesToCreate.map((c) => c.name).sort()).toEqual(['Grills', 'Juices'])
    expect(plan.itemsToCreate).toHaveLength(3)
    expect(itemIn('Grills', 'Peri Peri')!.price).toBe(3000)
    expect(itemIn('Grills', 'Garlic Chicken')!.price).toBe(3250)
  })

  it('leaves a new category unrouted so KOTs fall back to the default kitchen', () => {
    expect(categoryNamed('Juices')!.kitchenId).toBeNull()
  })

  it('updates the price on re-upload instead of duplicating the item', () => {
    const plan = run([{ category: 'Grills', item: 'Peri Peri', price: '34.00' }])

    expect(plan.itemsToCreate).toHaveLength(0)
    expect(plan.itemsToUpdate).toEqual([
      { category: 'Grills', name: 'Peri Peri', from: 3000, to: 3400 },
    ])
    const cat = categoryNamed('Grills')!
    const matches = db.select().from(s.items).where(eq(s.items.categoryId, cat.id)).all()
      .filter((i) => i.name === 'Peri Peri')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.price).toBe(3400)
  })

  it('counts an unchanged row rather than rewriting it', () => {
    const plan = run([{ category: 'Grills', item: 'Peri Peri', price: '34.00' }])
    expect(plan.unchanged).toBe(1)
    expect(plan.itemsToUpdate).toEqual([])
  })

  it('matches names case-insensitively', () => {
    const plan = run([{ category: 'GRILLS', item: 'peri peri', price: '34.00' }])
    expect(plan.categoriesToCreate).toEqual([])
    expect(plan.itemsToCreate).toEqual([])
    expect(plan.unchanged).toBe(1)
  })

  it('allows the same item name in two different categories', () => {
    const plan = run([
      { category: 'Grills', item: 'Water', price: '2.00' },
      { category: 'Juices', item: 'Water', price: '2.00' },
    ])
    expect(plan.itemsToCreate).toHaveLength(2)
    expect(itemIn('Grills', 'Water')!.price).toBe(200)
    expect(itemIn('Juices', 'Water')!.price).toBe(200)
  })
})

/* ─────────────────────────── kitchens ─────────────────────────── */

describe('kitchen column', () => {
  it('routes a new category to a kitchen named in the sheet', () => {
    const kitchen = db.select().from(s.kitchens).all()[0]!
    run([{ category: 'Routed', item: 'Thing', price: '5.00', kitchen: kitchen.name }])
    expect(categoryNamed('Routed')!.kitchenId).toBe(kitchen.id)
  })

  it('matches the kitchen name case-insensitively', () => {
    const kitchen = db.select().from(s.kitchens).all()[0]!
    const plan = run([
      { category: 'Routed Lower', item: 'Thing', price: '5.00', kitchen: kitchen.name.toUpperCase() },
    ], true)
    expect(plan.errors).toEqual([])
    expect(plan.categoriesToCreate).toEqual([{ name: 'Routed Lower', kitchen: kitchen.name }])
  })

  it('refuses an unknown kitchen rather than inventing one', () => {
    const plan = run([{ category: 'Bad Kitchen', item: 'Thing', price: '5.00', kitchen: 'Nowhere' }])

    expect(plan.applied).toBe(false)
    expect(plan.errors).toEqual([{ row: 1, message: expect.stringMatching(/no active kitchen called "Nowhere"/i) }])
    expect(categoryNamed('Bad Kitchen')).toBeUndefined()
    expect(db.select().from(s.kitchens).all().some((k) => k.name === 'Nowhere')).toBe(false)
  })

  it('warns rather than re-routing a category that already exists', () => {
    const other = db.select().from(s.kitchens).all()
      .find((k) => k.id !== categoryNamed('Routed')!.kitchenId)!
    const before = categoryNamed('Routed')!.kitchenId

    const plan = run([{ category: 'Routed', item: 'Thing', price: '5.00', kitchen: other.name }])

    expect(plan.errors).toEqual([])
    expect(plan.warnings).toEqual([{ row: 1, message: expect.stringMatching(/keeps its current kitchen/i) }])
    expect(categoryNamed('Routed')!.kitchenId).toBe(before)
  })
})

describe('kitchen routing safety', () => {
  const kitchens = () => db.select().from(s.kitchens).all()

  it('refuses one new category sent to two kitchens', () => {
    const [a, b] = kitchens()
    const plan = run([
      { category: 'Split', item: 'One', price: '1.00', kitchen: a!.name, line: 2 },
      { category: 'Split', item: 'Two', price: '1.00', kitchen: b!.name, line: 3 },
    ])
    expect(plan.applied).toBe(false)
    expect(plan.errors).toEqual([
      { row: 3, message: expect.stringMatching(new RegExp(`"Split" goes to "${a!.name}" on row 2`)) },
    ])
  })

  it('lets the kitchen appear on any one line of the category', () => {
    const [a] = kitchens()
    const plan = run([
      { category: 'Later Kitchen', item: 'One', price: '1.00' },
      { category: 'Later Kitchen', item: 'Two', price: '1.00', kitchen: a!.name },
    ])
    expect(plan.errors).toEqual([])
    expect(categoryNamed('Later Kitchen')!.kitchenId).toBe(a!.id)
  })

  it('reports against the line number the caller sent', () => {
    const plan = run([{ category: 'Lines', item: 'X', price: 'abc', line: 17 }], true)
    expect(plan.errors[0]!.row).toBe(17)
  })

  it('warns when a disabled category receives items', () => {
    run([{ category: 'Off Menu', item: 'First', price: '1.00' }])
    db.update(s.categories).set({ active: false }).where(eq(s.categories.name, 'Off Menu')).run()

    const plan = run([
      { category: 'Off Menu', item: 'Second', price: '1.00' },
      { category: 'Off Menu', item: 'Third', price: '1.00' },
    ], true)
    expect(plan.warnings).toEqual([{ row: 1, message: expect.stringMatching(/"Off Menu" is disabled/) }])
  })

  it('warns when a new category has no kitchen and there is no default', () => {
    const before = db.select().from(s.settings).get()!.defaultKitchenId
    db.update(s.settings).set({ defaultKitchenId: null }).run()
    try {
      const plan = run([{ category: 'Homeless', item: 'X', price: '1.00' }], true)
      expect(plan.warnings).toEqual([{ row: 1, message: expect.stringMatching(/no default kitchen is set/) }])
    } finally {
      db.update(s.settings).set({ defaultKitchenId: before }).run()
    }
  })

  it('does not warn about a missing kitchen when a default exists', () => {
    const plan = run([{ category: 'Defaulted', item: 'X', price: '1.00' }], true)
    expect(plan.warnings).toEqual([])
  })
})

/* ─────────────────────────── bad input ─────────────────────────── */

describe('validation', () => {
  it('reports the row number for every bad row and writes nothing', () => {
    const before = db.select().from(s.items).all().length
    const plan = run([
      { category: 'Fine', item: 'Good', price: '10.00' },
      { category: '', item: 'No category', price: '10.00' },
      { category: 'Fine', item: '', price: '10.00' },
      { category: 'Fine', item: 'Bad price', price: 'twelve' },
    ])

    expect(plan.applied).toBe(false)
    expect(plan.errors.map((e) => e.row)).toEqual([2, 3, 4])
    // One bad row blocks the whole sheet — a half-imported menu is worse.
    expect(db.select().from(s.items).all()).toHaveLength(before)
    expect(categoryNamed('Fine')).toBeUndefined()
  })

  it('rejects the same item twice in one sheet and names both rows', () => {
    const plan = run([
      { category: 'Dupes', item: 'Twice', price: '10.00' },
      { category: 'Dupes', item: 'TWICE', price: '12.00' },
    ])
    expect(plan.errors).toEqual([{ row: 2, message: expect.stringMatching(/also on row 1/i) }])
  })

  it('refuses an oversized sheet', () => {
    const rows = Array.from({ length: 2001 }, (_, i) => ({
      category: 'Big', item: `Item ${i}`, price: '1.00',
    }))
    expect(() => run(rows)).toThrow(/at most 2000 rows/i)
  })

  it('rejects an unknown employee', () => {
    expect(() => importMenu([{ category: 'X', item: 'Y', price: '1.00' }], { dryRun: true }, 'nobody'))
      .toThrow(/employee/i)
  })
})

/* ─────────────────────────── audit ─────────────────────────── */

describe('audit', () => {
  it('writes one entry when applied and none for a dry run', () => {
    const count = () => db.select().from(s.auditLog).all()
      .filter((a) => a.action === 'master.import_menu').length

    const before = count()
    run([{ category: 'Audited', item: 'Thing', price: '9.00' }], true)
    expect(count()).toBe(before)

    run([{ category: 'Audited', item: 'Thing', price: '9.00' }])
    expect(count()).toBe(before + 1)
  })
})

/* ─────────────────────────── HTTP route ─────────────────────────── */

describe('POST /api/masters/menu/import', () => {
  const post = async (payload: Record<string, unknown>, remoteAddress = '127.0.0.1') => {
    const { createServer } = await import('../index.js')
    const app = await createServer({ logger: false })
    try {
      return await app.inject({ method: 'POST', url: '/api/masters/menu/import', remoteAddress, payload })
    } finally {
      await app.close()
    }
  }

  it('only plans unless dryRun is explicitly false', async () => {
    const rows = [{ category: 'Routed', item: 'Plan Only', price: '4.00' }]
    const res = await post({ rows, employeeId: admin })
    expect(res.statusCode).toBe(200)
    expect(res.json().applied).toBe(false)
    expect(itemIn('Routed', 'Plan Only')).toBeUndefined()

    const applied = await post({ rows, dryRun: false, employeeId: admin })
    expect(applied.json().applied).toBe(true)
    expect(itemIn('Routed', 'Plan Only')?.price).toBe(400)
  })

  it('rejects a body without rows', async () => {
    const res = await post({ employeeId: admin })
    expect(res.statusCode).toBe(409)
  })

  it('is not reachable from the LAN without being the counter', async () => {
    const res = await post({ rows: [], employeeId: admin }, '192.168.1.50')
    expect(res.statusCode).toBeGreaterThanOrEqual(401)
    expect(res.statusCode).toBeLessThan(404)
  })
})
