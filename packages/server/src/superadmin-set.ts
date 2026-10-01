/**
 * Set the superadmin password from the counter PC itself.
 *
 *   pnpm superadmin:set -- "a good password"
 *
 * The last resort: if the superadmin password is lost too, this is the only way
 * back, and it requires physical (or remote-desktop) access to the shop's PC —
 * which is the right bar for a door that can reset every admin PIN.
 */
import { migrateDb } from './db.js'
import { setSuperadminPassword } from './services/superadmin.js'

const password = process.argv.slice(2).join(' ').trim()
if (!password) {
  console.error('usage: pnpm superadmin:set -- "<password>"')
  process.exit(1)
}

migrateDb()
setSuperadminPassword(password)
console.log('Superadmin password updated. It is stored hashed; write it down somewhere safe.')
