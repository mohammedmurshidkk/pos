import { eq } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db, raw } from '../db.js'
import { conflict } from '../errors.js'
import { requireEmployee } from './employees.js'

const s = schema

/** A bad paste must not be able to lock the database for a minute. */
const MAX_ROWS = 2000

/** One line of the spreadsheet. Everything arrives as text; nothing is trusted. */
export interface MenuImportRow {
  category: string
  item: string
  price: string | number
  /** Optional. Matched to an existing kitchen by name — never creates one. */
  kitchen?: string | null
  /** Optional search code ("cb"). Blank leaves an existing item's short name alone. */
  shortName?: string | null
  sort?: number | string | null
  /** The spreadsheet line this came from, so messages match what the operator sees. */
  line?: number | null
}

export interface MenuImportPlan {
  categoriesToCreate: { name: string; kitchen: string | null }[]
  itemsToCreate: { category: string; name: string; price: number; shortName: string | null }[]
  itemsToUpdate: { category: string; name: string; from: number; to: number }[]
  /** Existing items whose short name the sheet sets or changes. */
  shortNamesToSet: { category: string; name: string; from: string | null; to: string }[]
  unchanged: number
  /** Blocking. Nothing is written while this is non-empty. */
  errors: { row: number; message: string }[]
  /** Non-blocking — applied anyway, but the operator should see them. */
  warnings: { row: number; message: string }[]
  applied: boolean
}

function settings() {
  const row = db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()
  if (!row) throw new Error('settings missing — the hub has not been seeded')
  return row
}

/**
 * Text from a spreadsheet cell to minor units.
 *
 * `Number('30.00') * 100` is 3000.0000000000005 on some values, so the result is
 * rounded rather than truncated — but only after rejecting anything with more
 * decimal places than the currency has. Silently rounding 30.005 to 30.01 would
 * put a price on the menu that nobody typed.
 */
export function parsePrice(raw: string | number, decimals: number): { minor: number } | { error: string } {
  const text = String(raw).trim().replace(/,/g, '')
  if (text === '') return { error: 'price is empty' }
  if (!/^\d*\.?\d+$/.test(text)) return { error: `price "${raw}" is not a number` }

  const dot = text.indexOf('.')
  const places = dot === -1 ? 0 : text.length - dot - 1
  if (places > decimals) {
    return { error: `price "${raw}" has ${places} decimal places, this currency has ${decimals}` }
  }

  const minor = Math.round(Number(text) * 10 ** decimals)
  if (!Number.isSafeInteger(minor)) return { error: `price "${raw}" is out of range` }
  return { minor }
}

/** Same limit as Setup → Items. */
const SHORT_NAME_MAX = 20

const key = (category: string, item: string) => `${category.toLowerCase()}\u0000${item.toLowerCase()}`

/**
 * Create categories and items from a spreadsheet, in one transaction.
 *
 * Two-phase on purpose: call it with `dryRun` to get the plan, show that to the
 * operator, then call it again to apply. A typo in row 40 has to be visible
 * before anything is written, because the person doing this on site is usually
 * not the person who built the sheet.
 *
 * Deliberate omissions:
 *  - **Kitchens are never created.** `kitchens.printer_id` is NOT NULL, so a
 *    sheet would have to invent a printer. An unknown kitchen name is an error.
 *  - **A category's kitchen is only set when the category is created.** Silently
 *    re-routing an existing category's KOTs because a sheet said so is not a
 *    thing an import should do; it warns instead.
 *  - **Items missing from the sheet are left alone.** Nothing is deleted or
 *    deactivated here — that stays a deliberate act in Setup.
 *
 * Re-uploading a corrected sheet is safe and expected: rows match on name, so
 * an item's price is updated rather than duplicated. Past invoices are unharmed
 * because order lines snapshot their own name and price.
 */
export function importMenu(
  rows: MenuImportRow[],
  opts: { dryRun: boolean },
  employeeId: string,
): MenuImportPlan {
  requireEmployee(employeeId)
  if (rows.length > MAX_ROWS) throw conflict(`Import at most ${MAX_ROWS} rows at a time.`)

  const { currencyDecimals: decimals, defaultKitchenId } = settings()
  const errors: MenuImportPlan['errors'] = []
  const warnings: MenuImportPlan['warnings'] = []

  const kitchens = db.select().from(s.kitchens).where(eq(s.kitchens.active, true)).all()
  const kitchenByName = new Map(kitchens.map((k) => [k.name.toLowerCase(), k]))

  const existingCategories = db.select().from(s.categories).all()
  const categoryByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c]))

  const existingItems = db.select().from(s.items).all()
  const itemsByCategory = new Map<string, Map<string, typeof existingItems[number]>>()
  for (const it of existingItems) {
    const bucket = itemsByCategory.get(it.categoryId) ?? new Map()
    bucket.set(it.name.toLowerCase(), it)
    itemsByCategory.set(it.categoryId, bucket)
  }

  /** Category name (lowercased) → the kitchen id to use if we create it. */
  const newCategoryKitchen = new Map<string, string | null>()
  const newCategoryName = new Map<string, string>()
  /** One warning per category, not one per item line. */
  const warnedCategory = new Set<string>()
  /** First row that named a new category (or its kitchen) — for messages. */
  const categoryRow = new Map<string, number>()
  const kitchenRow = new Map<string, number>()
  const planned = new Map<string, { category: string; item: string; price: number; shortName: string | null; row: number }>()
  /** Short name (lowercased) → first row that used it, to flag a clash within the sheet. */
  const shortNameRow = new Map<string, number>()

  rows.forEach((raw, i) => {
    // The caller's own line number when it sent one (a CSV skips its header
    // and blank lines); otherwise 1-based position in the list.
    const row = Number.isSafeInteger(raw.line) ? raw.line! : i + 1
    const category = String(raw.category ?? '').trim()
    const item = String(raw.item ?? '').trim()

    if (category === '') return void errors.push({ row, message: 'category is empty' })
    if (item === '') return void errors.push({ row, message: 'item is empty' })

    const price = parsePrice(raw.price, decimals)
    if ('error' in price) return void errors.push({ row, message: price.error })

    const shortName = String(raw.shortName ?? '').trim() || null
    if (shortName && shortName.length > SHORT_NAME_MAX) {
      return void errors.push({ row, message: `short name "${shortName}" is longer than ${SHORT_NAME_MAX} characters` })
    }

    const dup = planned.get(key(category, item))
    if (dup) {
      return void errors.push({ row, message: `"${item}" in "${category}" is also on row ${dup.row}` })
    }

    const existingCategory = categoryByName.get(category.toLowerCase())
    const kitchenName = String(raw.kitchen ?? '').trim()

    if (kitchenName !== '') {
      const kitchen = kitchenByName.get(kitchenName.toLowerCase())
      if (!kitchen) {
        return void errors.push({
          row,
          message: `no active kitchen called "${kitchenName}" — create it under Setup first`,
        })
      }
      if (existingCategory) {
        if (existingCategory.kitchenId !== kitchen.id) {
          warnings.push({
            row,
            message: `"${category}" already exists and keeps its current kitchen — change it under Setup`,
          })
        }
      } else {
        // A kitchen may be given on any line of the category, but only one.
        // Letting the last line win would route a whole category's KOTs by
        // accident of row order.
        const earlier = newCategoryKitchen.get(category.toLowerCase())
        if (earlier && earlier !== kitchen.id) {
          const first = kitchens.find((k) => k.id === earlier)!.name
          return void errors.push({
            row,
            message: `"${category}" goes to "${first}" on row ${kitchenRow.get(category.toLowerCase())} — one category, one kitchen`,
          })
        }
        newCategoryKitchen.set(category.toLowerCase(), kitchen.id)
        kitchenRow.set(category.toLowerCase(), row)
      }
    } else if (!existingCategory && !newCategoryKitchen.has(category.toLowerCase())) {
      // Null is legitimate: KOT routing falls back to settings.defaultKitchenId.
      newCategoryKitchen.set(category.toLowerCase(), null)
    }

    if (existingCategory && !existingCategory.active && !warnedCategory.has(category.toLowerCase())) {
      warnedCategory.add(category.toLowerCase())
      warnings.push({
        row,
        message: `"${category}" is disabled — its items will not show until you enable it under Categories`,
      })
    }
    if (!existingCategory) {
      newCategoryName.set(category.toLowerCase(), category)
      if (!categoryRow.has(category.toLowerCase())) categoryRow.set(category.toLowerCase(), row)
    }
    if (shortName) {
      // Not blocking: two items may share a code, but a search would show both.
      const earlier = shortNameRow.get(shortName.toLowerCase())
      if (earlier) warnings.push({ row, message: `short name "${shortName}" is also used on row ${earlier}` })
      else shortNameRow.set(shortName.toLowerCase(), row)
    }
    planned.set(key(category, item), { category, item, price: price.minor, shortName, row })
  })

  // After the loop: any line of the category may have supplied the kitchen.
  if (!defaultKitchenId) {
    for (const [lower, name] of newCategoryName) {
      if (newCategoryKitchen.get(lower)) continue
      warnings.push({
        row: categoryRow.get(lower)!,
        message: `"${name}" has no kitchen and no default kitchen is set — its KOTs cannot print until you pick one`,
      })
    }
  }

  const categoriesToCreate = [...newCategoryName.entries()].map(([lower, name]) => ({
    name,
    kitchen: (() => {
      const id = newCategoryKitchen.get(lower) ?? null
      return id ? kitchens.find((k) => k.id === id)?.name ?? null : null
    })(),
  }))

  const itemsToCreate: MenuImportPlan['itemsToCreate'] = []
  const itemsToUpdate: MenuImportPlan['itemsToUpdate'] = []
  const shortNamesToSet: MenuImportPlan['shortNamesToSet'] = []
  let unchanged = 0

  for (const p of planned.values()) {
    const existingCategory = categoryByName.get(p.category.toLowerCase())
    const existing = existingCategory
      ? itemsByCategory.get(existingCategory.id)?.get(p.item.toLowerCase())
      : undefined
    if (!existing) {
      itemsToCreate.push({ category: p.category, name: p.item, price: p.price, shortName: p.shortName })
      continue
    }
    const priceChanged = existing.price !== p.price
    const shortChanged = p.shortName != null && p.shortName !== existing.shortName
    if (priceChanged) itemsToUpdate.push({ category: p.category, name: p.item, from: existing.price, to: p.price })
    if (shortChanged) {
      shortNamesToSet.push({ category: p.category, name: p.item, from: existing.shortName, to: p.shortName! })
    }
    if (!priceChanged && !shortChanged) unchanged += 1
  }

  const plan: MenuImportPlan = {
    categoriesToCreate, itemsToCreate, itemsToUpdate, shortNamesToSet, unchanged, errors, warnings, applied: false,
  }

  if (opts.dryRun || errors.length > 0) return plan

  raw.transaction(() => {
    const categoryId = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c.id]))

    for (const [lower, name] of newCategoryName) {
      const id = newId()
      db.insert(s.categories).values({
        id, name, kitchenId: newCategoryKitchen.get(lower) ?? null, sort: 0,
      }).run()
      categoryId.set(lower, id)
    }

    for (const p of planned.values()) {
      const catId = categoryId.get(p.category.toLowerCase())!
      const existing = itemsByCategory.get(catId)?.get(p.item.toLowerCase())
      if (!existing) {
        db.insert(s.items).values({
          id: newId(), categoryId: catId, name: p.item, shortName: p.shortName, price: p.price, sort: 0,
        }).run()
        continue
      }
      const change: { price?: number; shortName?: string } = {}
      if (existing.price !== p.price) change.price = p.price
      if (p.shortName != null && p.shortName !== existing.shortName) change.shortName = p.shortName
      if (Object.keys(change).length > 0) db.update(s.items).set(change).where(eq(s.items.id, existing.id)).run()
    }
  })()

  audit(employeeId, 'master.import_menu', 'items', null, {
    categoriesCreated: categoriesToCreate.length,
    itemsCreated: itemsToCreate.length,
    itemsUpdated: itemsToUpdate.length,
    shortNamesSet: shortNamesToSet.length,
    unchanged,
  })

  return { ...plan, applied: true }
}
