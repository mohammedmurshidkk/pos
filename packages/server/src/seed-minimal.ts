import { randomBytes } from 'node:crypto'
import { newId, schema } from '@pos/shared'
import { hashPin } from './services/auth.js'
import { setSuperadminPassword } from './services/superadmin.js'
import { db, raw } from './db.js'

const s = schema

/**
 * The smallest database the hub can actually run on — for a real install, where
 * the shop's own printers, kitchens, menu and staff get entered through Setup.
 *
 * Not the same thing as an empty database. Two rows have to exist or the app is
 * unusable and, worse, unfixable from the UI:
 *
 *   settings   `billing.ts` and `orders.ts` both throw "settings missing" the
 *              moment anything is priced. Every column has a schema default, so
 *              the row is created bare and edited under Setup.
 *   one admin  the counter Login needs an employee with a PIN. With no employees
 *              nobody can sign in, and masters can only be created once signed
 *              in — so an empty database locks you out of its own setup screen.
 *
 * Everything else — printers, kitchens, counters, categories, items, areas,
 * tables, payment modes, expense categories — is left for you to create.
 *
 *   pnpm seed:minimal                       → "Admin", PIN 1234
 *   pnpm seed:minimal -- "Murshid" 4321     → your own name and PIN
 *
 * Use `pnpm seed` instead for the Al Manzil demo dataset.
 */
export function seedMinimal(name = 'Admin', pin = '1234'): boolean {
  const existing = raw.prepare('select count(*) as n from settings').get() as { n: number }
  // Silent when there is nothing to do: startServer calls this on every boot, and
  // a "delete pos.db first" line printed at each startup of a working install
  // reads like a failure. The CLI below says it instead, where it is the answer
  // to something you just typed.
  if (existing.n > 0) return false

  // Bare row: the schema already defaults to AE / AED / VAT 500bp / TRN / INV-,
  // invoice and order numbering from 1, and a null default kitchen. Fill in the
  // business name, TRN and tax rate under Setup — nothing here hardcodes them.
  db.insert(s.settings).values({ id: 'singleton' }).run()

  db.insert(s.employees).values({
    id: newId(),
    name,
    role: 'admin',
    pinHash: hashPin(pin),
    canDiscount: true,
    maxDiscountPercent: 100,
    canSaveWithoutKot: true,
  }).run()

  // Random, not a constant: a shared default would be the same on every
  // installation, and this password can reset any admin PIN.
  const superadmin = randomBytes(9).toString('base64url').slice(0, 12)
  setSuperadminPassword(superadmin)

  console.log(`minimal seed: settings + one admin "${name}" (PIN ${pin}).`)
  console.log(`SUPERADMIN PASSWORD: ${superadmin}   <- write this down, it is shown once`)
  console.log('Lost it? Run `pnpm superadmin:set -- "<password>"` on this PC.')
  console.log('Create printers → kitchens → counters → categories → items, then areas, tables, staff and payment modes under Setup.')
  return true
}

// Only auto-run when invoked directly, so tests can import it.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!seedMinimal(process.argv[2], process.argv[3])) {
    console.log('database already has a settings row — delete pos.db first to start clean')
  }
}
