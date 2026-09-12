import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { schema } from '@pos/shared'

/**
 * The hub database. One file, one branch, the whole business.
 *
 * On Windows this must live under app.getPath('userData') — never hardcode a
 * path. POS_DB lets the Electron shell hand us the right location.
 */
const file = process.env.POS_DB ?? './pos.db'

const sqlite = new Database(file)
// WAL survives power cuts far better than the default rollback journal, and
// lets the print queue read while an order is being written.
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
// NORMAL is the right trade-off with WAL: durable across app crashes, and we
// take a VACUUM INTO snapshot at every shift close anyway.
sqlite.pragma('synchronous = NORMAL')

type Sqlite = InstanceType<typeof Database>

export const db = drizzle(sqlite, { schema })
/** Escape hatch for transactions and pragmas that Drizzle doesn't cover. */
export const raw: Sqlite = sqlite

/**
 * Apply generated migrations. Same DDL in dev, tests and on the client's PC —
 * hand-written CREATE TABLE would drift from the Drizzle schema within a week.
 */
export function migrateDb(): void {
  // Once bundled into the Electron app this file no longer sits in src/, so the
  // relative walk is wrong. The shell passes the packaged location explicitly.
  const folder =
    process.env.POS_MIGRATIONS ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
  migrate(db, { migrationsFolder: folder })
}

/** Shift-close backup. ~30 lines that stand between the client and ruin. */
export function backupTo(path: string): void {
  sqlite.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`)
}
