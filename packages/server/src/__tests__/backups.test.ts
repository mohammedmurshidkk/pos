import { existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(path.join(tmpdir(), 'pos-backups-'))
process.env.POS_DB = path.join(dir, 'test.db')
process.env.POS_PRINT_DISABLED = '1'
delete process.env.POS_BACKUP_DIR

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const { backupDirectory, backupStatus, pruneBackups, runBackup, setBackupDirectory, RETENTION_DAYS } =
  await import('../services/backups.js')
const { discardPrintJob, listPrintJobs, printJobCounts, retryPrintJob } = await import('../services/print-jobs.js')
const { closeShift, openShift } = await import('../services/shifts.js')
const { eq } = await import('drizzle-orm')

const s = schema
let fatima = ''

beforeAll(() => {
  migrateDb()
  seed()
  fatima = db.select().from(s.employees).where(eq(s.employees.name, 'Fatima')).get()!.id
})

const DAY = 24 * 60 * 60 * 1000
/** A fake old backup, dated `days` ago. */
function oldBackup(folder: string, name: string, days: number) {
  const f = path.join(folder, name)
  writeFileSync(f, 'x')
  const t = new Date(Date.now() - days * DAY)
  utimesSync(f, t, t)
}

describe('backups', () => {
  it('defaults to a backups folder next to the database and creates it', () => {
    expect(backupDirectory()).toBe(path.join(dir, 'backups'))
    expect(backupStatus().overdue).toBe(true)
    const r = runBackup('manual', { employeeId: fatima })
    expect(existsSync(r.path)).toBe(true)
    expect(r.bytes).toBeGreaterThan(0)
    const st = backupStatus()
    expect(st.overdue).toBe(false)
    expect(st.count).toBe(1)
    expect(st.lastBackupAt).not.toBeNull()
    expect(st.retentionDays).toBe(30)
  })

  it('keeps 30 days, always keeps the newest, and leaves other files alone', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'pos-prune-'))
    oldBackup(folder, 'pos-old.db', RETENTION_DAYS + 5)
    oldBackup(folder, 'before-clear-orders-old.db', RETENTION_DAYS + 1)
    oldBackup(folder, 'pos-recent.db', 3)
    oldBackup(folder, 'my-notes.db', 400)
    expect(pruneBackups(folder).sort()).toEqual(['before-clear-orders-old.db', 'pos-old.db'])
    expect(readdirSync(folder).sort()).toEqual(['my-notes.db', 'pos-recent.db'])

    // A shop closed for two months still has its last backup.
    const quiet = mkdtempSync(path.join(tmpdir(), 'pos-quiet-'))
    oldBackup(quiet, 'pos-a.db', 60)
    oldBackup(quiet, 'pos-b.db', 90)
    expect(pruneBackups(quiet)).toEqual(['pos-b.db'])
    expect(readdirSync(quiet)).toEqual(['pos-a.db'])
  })

  it('uses the folder chosen in Settings, and refuses one it cannot use', () => {
    expect(() => setBackupDirectory('relative/folder', fatima)).toThrow(/full folder path/i)
    const chosen = path.join(dir, 'chosen', 'nested')
    const st = setBackupDirectory(chosen, fatima)
    expect(st.dir).toBe(chosen)
    expect(st.custom).toBe(true)
    expect(existsSync(chosen)).toBe(true)
    expect(path.dirname(runBackup('manual').path)).toBe(chosen)

    // Back to the default.
    expect(setBackupDirectory(null, fatima).custom).toBe(false)
    expect(backupDirectory()).toBe(path.join(dir, 'backups'))
  })

  it('records a failure for the status screens', () => {
    const blocker = path.join(dir, 'a-file')
    writeFileSync(blocker, 'not a folder')
    expect(() => runBackup('manual', { dir: path.join(blocker, 'sub') })).toThrow(/Backup failed/)
    expect(backupStatus().lastError?.message).toBeTruthy()
    runBackup('manual')
    expect(backupStatus().lastError).toBeNull()
  })

  it('closes the shift even when the backup cannot be written', () => {
    const counterId = db.select().from(s.counters).get()!.id
    const shift = openShift({ counterId, employeeId: fatima, openingFloat: 0 })
    const blocker = path.join(dir, 'another-file')
    writeFileSync(blocker, 'x')
    const r = closeShift(shift.id, 0, fatima, path.join(blocker, 'sub'))
    expect(r.backupPath).toBeNull()
    expect(r.backupError).toMatch(/Backup failed/)
    expect(db.select().from(s.shifts).where(eq(s.shifts.id, shift.id)).get()!.closedAt).not.toBeNull()
  })
})

describe('print job detail', () => {
  function job(status: 'pending' | 'failed' | 'done', payload: object = { orderNo: 7, tableLabel: 'T3', kitchenName: 'Grill', kind: 'new' }) {
    const printerId = db.select().from(s.printers).get()!.id
    const id = `job-${Math.random().toString(36).slice(2)}`
    db.insert(s.printJobs).values({
      id, printerId, kind: 'kot', payloadJson: JSON.stringify(payload), status,
      attempts: status === 'failed' ? 5 : 0, lastError: status === 'failed' ? 'connect ECONNREFUSED' : null,
    }).run()
    return id
  }

  it('lists problems with a readable label and per-printer counts', () => {
    const failed = job('failed')
    job('done')
    const rows = listPrintJobs()
    const row = rows.find((r) => r.id === failed)!
    expect(row.detail).toBe('Grill · Order #7 · Table T3')
    expect(row.kindLabel).toBe('KOT')
    expect(row.lastError).toMatch(/ECONNREFUSED/)
    expect(rows.every((r) => r.status !== 'done')).toBe(true)
    expect(listPrintJobs({ filter: 'all' }).some((r) => r.status === 'done')).toBe(true)
    expect(Object.values(printJobCounts()).reduce((a, c) => a + c.failed, 0)).toBeGreaterThan(0)
  })

  it('discards a failed job, then can bring it back', () => {
    const id = job('failed')
    expect(discardPrintJob(id, fatima).status).toBe('discarded')
    expect(listPrintJobs().some((r) => r.id === id)).toBe(false)
    expect(() => discardPrintJob(id, fatima)).toThrow(/Only waiting or failed/)

    expect(retryPrintJob(id, fatima).status).toBe('pending')
    const stored = db.select().from(s.printJobs).where(eq(s.printJobs.id, id)).get()!
    expect(stored.attempts).toBe(0)
    expect(stored.lastError).toBeNull()
  })

  it('refuses to retry a job that printed or is already queued', () => {
    expect(() => retryPrintJob(job('done'), fatima)).toThrow(/already printed/)
    expect(() => retryPrintJob(job('pending'), fatima)).toThrow(/already in the queue/)
    const audits = db.select().from(s.auditLog).all().filter((a) => a.action.startsWith('print_job.'))
    expect(audits.length).toBeGreaterThanOrEqual(2)
  })
})
