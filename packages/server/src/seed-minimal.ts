import { newId, schema } from '@pos/shared'
import { hashPin } from './services/auth.js'
import { db, raw } from './db.js'

const s = schema

/**
 * The smallest database the hub can run on — what a real install starts from.
 *
 * Just the settings row: `billing.ts` and `orders.ts` both throw "settings
 * missing" the moment anything is priced. Every column has a schema default, so
 * the row is created bare and edited under Setup.
 *
 * Deliberately NOT created: an admin, a superadmin password and a trial. A fresh
 * install opens on the first-time setup screen, where whoever installs it sets
 * the superadmin password, adds the first admin with a starting PIN, and grants
 * the trial (or activates a licence key). There is no shared default anywhere.
 *
 *   pnpm seed:minimal                       → settings only (as on first run)
 *   pnpm seed:minimal -- "Murshid" 4321     → also an admin, for local testing
 *
 * Use `pnpm seed` instead for the Al Manzil demo dataset.
 */
export function seedMinimal(name?: string, pin?: string): boolean {
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

  if (name && pin) {
    db.insert(s.employees).values({
      id: newId(),
      name,
      role: 'admin',
      pinHash: hashPin(pin),
      canDiscount: true,
      maxDiscountPercent: 100,
      canSaveWithoutKot: true,
    }).run()
    console.log(`minimal seed: settings + one admin "${name}" (PIN ${pin}).`)
  } else {
    console.log('minimal seed: settings only. Open the app on this PC to run first-time setup.')
  }
  return true
}

// Only auto-run when invoked directly, so tests can import it.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!seedMinimal(process.argv[2], process.argv[3])) {
    console.log('database already has a settings row — delete pos.db first to start clean')
  }
}
