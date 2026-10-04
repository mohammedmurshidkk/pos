import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { schema } from '@pos/shared'
import { audit } from '../audit.js'
import { backupTo, db } from '../db.js'
import { conflict } from '../errors.js'

const s = schema

/** Backups older than this are deleted after each new one. */
export const RETENTION_DAYS = 30
/** The automatic backup runs when the last one is older than this. */
const DAILY_MS = 24 * 60 * 60 * 1000
/** Every file this service writes or prunes matches this. Nothing else in the folder is touched. */
const OURS = /^(pos|before-clear)-.*\.db$/

type Reason = 'manual' | 'daily' | 'shift_close' | 'before_clear'

/** The last automatic or manual failure, so Settings and the Dashboard can say why. */
let lastError: { at: Date; message: string } | null = null

function settingsRow() {
  return db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()
}

/**
 * Where backups go: the folder chosen in Settings, else the one the Windows
 * shell hands us (userData/backups), else a `backups` folder next to the
 * database file.
 */
export function backupDirectory(): string {
  const chosen = settingsRow()?.backupDir
  if (chosen) return chosen
  if (process.env.POS_BACKUP_DIR) return process.env.POS_BACKUP_DIR
  const dbFile = process.env.POS_DB ?? './pos.db'
  return path.join(path.dirname(path.resolve(dbFile)), 'backups')
}

export function listBackups(dir = backupDirectory()) {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((n) => OURS.test(n))
    .map((name) => {
      const st = statSync(path.join(dir, name))
      return { name, bytes: st.size, createdAt: st.mtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Delete backups older than the retention window. The newest backup is always
 * kept, however old: a shop closed for Ramadan must not come back to nothing.
 */
export function pruneBackups(dir = backupDirectory(), now = Date.now()): string[] {
  const cutoff = now - RETENTION_DAYS * DAILY_MS
  const [newest, ...rest] = listBackups(dir)
  if (!newest) return []
  const removed: string[] = []
  for (const b of rest) {
    if (new Date(b.createdAt).getTime() < cutoff) {
      rmSync(path.join(dir, b.name), { force: true })
      removed.push(b.name)
    }
  }
  return removed
}

/**
 * Take a backup now: a consistent copy of the live database (VACUUM INTO, safe
 * while orders are being written), then prune old ones. Throws on failure so
 * the caller can say so; `lastError` keeps the reason for the status screens.
 */
export function runBackup(reason: Reason, opts: { dir?: string; employeeId?: string | null; label?: string } = {}) {
  const dir = opts.dir ?? backupDirectory()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = reason === 'before_clear' ? `before-clear-${opts.label ?? 'data'}-${stamp}.db` : `pos-${stamp}.db`
  const file = path.join(dir, name)
  try {
    mkdirSync(dir, { recursive: true })
    backupTo(file)
  } catch (e) {
    lastError = { at: new Date(), message: e instanceof Error ? e.message : String(e) }
    throw conflict(`Backup failed: ${lastError.message}`)
  }
  lastError = null
  db.update(s.settings).set({ lastBackupAt: new Date() }).where(eq(s.settings.id, 'singleton')).run()
  let pruned: string[] = []
  try {
    pruned = pruneBackups(dir)
  } catch { /* a stuck old file must not fail today's backup */ }
  if (opts.employeeId !== undefined) {
    audit(opts.employeeId, 'backup.run', 'settings', 'singleton', { reason, file, pruned: pruned.length })
  }
  return { path: file, bytes: statSync(file).size, pruned }
}

export function backupStatus() {
  const dir = backupDirectory()
  const files = listBackups(dir)
  const last = settingsRow()?.lastBackupAt ?? null
  return {
    dir,
    custom: Boolean(settingsRow()?.backupDir),
    lastBackupAt: last ? new Date(last).toISOString() : null,
    /** No backup in the last day — the Dashboard shows this as a warning. */
    overdue: !last || Date.now() - new Date(last).getTime() > DAILY_MS,
    retentionDays: RETENTION_DAYS,
    count: files.length,
    totalBytes: files.reduce((a, f) => a + f.bytes, 0),
    recent: files.slice(0, 10),
    lastError: lastError ? { at: lastError.at.toISOString(), message: lastError.message } : null,
  }
}

/**
 * Change the backup folder. It must be an absolute path we can actually write
 * to — checked now, not discovered at 2 a.m. when the shift closes. Null goes
 * back to the default.
 */
export function setBackupDirectory(dir: string | null, employeeId: string) {
  const next = dir?.trim() || null
  if (next) {
    if (!path.isAbsolute(next)) throw conflict('Use a full folder path, for example D:\\POS Backups.')
    try {
      mkdirSync(next, { recursive: true })
      const probe = path.join(next, '.pos-write-test')
      writeFileSync(probe, 'ok')
      rmSync(probe, { force: true })
    } catch (e) {
      throw conflict(`Cannot write to that folder: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  db.update(s.settings).set({ backupDir: next }).where(eq(s.settings.id, 'singleton')).run()
  audit(employeeId, 'backup.folder', 'settings', 'singleton', { dir: next })
  return backupStatus()
}

/**
 * Daily safety net. Shift close already backs up, but a shop that forgets to
 * close for a week would otherwise have nothing newer than last week. Checked
 * hourly; runs only when the last backup is more than a day old.
 */
export function startDailyBackups(): () => void {
  const check = () => {
    if (!backupStatus().overdue) return
    try {
      runBackup('daily', { employeeId: null })
    } catch { /* recorded in lastError, shown on Settings and Dashboard */ }
  }
  check()
  const t = setInterval(check, 60 * 60 * 1000)
  t.unref?.()
  return () => clearInterval(t)
}
