import { desc, eq, inArray } from 'drizzle-orm'
import { schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db } from '../db.js'
import { conflict, notFound } from '../errors.js'
import { printQueue } from '../queue.js'

const s = schema

type Status = (typeof s.printJobs.$inferSelect)['status']

const KIND_LABEL: Record<string, string> = {
  kot: 'KOT', bill: 'Bill', invoice: 'Bill', void: 'Void slip', report: 'Z report', test: 'Test page', drawer: 'Cash drawer',
}

/** What a cashier recognises the job by: the order and table, not an id. */
function describe(kind: string, payloadJson: string): string {
  let p: Record<string, unknown> = {}
  try { p = JSON.parse(payloadJson) as Record<string, unknown> } catch { /* old or broken payload */ }
  const parts: string[] = []
  if (kind === 'kot' && typeof p.kitchenName === 'string') parts.push(p.kitchenName)
  if (typeof p.invoiceNo === 'string' && p.invoiceNo) parts.push(p.invoiceNo)
  if (typeof p.orderNo === 'number') parts.push(`Order #${p.orderNo}`)
  // Car orders carry the plate in tableLabel; only dine-in is a table.
  if (typeof p.tableLabel === 'string' && p.tableLabel) {
    parts.push(p.orderType === 'dine_in' || p.orderType === undefined ? `Table ${p.tableLabel}` : p.tableLabel)
  }
  if (kind === 'kot' && p.kind === 'addon') parts.push('add-on')
  if (kind === 'kot' && p.kind === 'void') parts.push('cancelled')
  return parts.join(' · ')
}

export type PrintJobRow = ReturnType<typeof listPrintJobs>[number]

/**
 * The queue as the cashier sees it. "problems" is what needs a decision:
 * failed jobs and anything still waiting. "all" adds the recent history.
 */
export function listPrintJobs(opts: { filter?: 'problems' | 'all'; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const statuses: Status[] = opts.filter === 'all'
    ? ['pending', 'printing', 'failed', 'done', 'discarded']
    : ['pending', 'printing', 'failed']
  const printers = new Map(db.select().from(s.printers).all().map((p) => [p.id, p.name]))
  return db
    .select()
    .from(s.printJobs)
    .where(inArray(s.printJobs.status, statuses))
    .orderBy(desc(s.printJobs.createdAt))
    .limit(limit)
    .all()
    // Failed first: those are the tickets nobody has seen.
    .sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'))
    .map((j) => ({
      id: j.id,
      printerId: j.printerId,
      printerName: printers.get(j.printerId) ?? 'Removed printer',
      kind: j.kind,
      kindLabel: KIND_LABEL[j.kind] ?? j.kind,
      detail: describe(j.kind, j.payloadJson),
      status: j.status,
      attempts: j.attempts,
      lastError: j.lastError,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    }))
}

/** Counts per printer for the header strip and the Dashboard. */
export function printJobCounts() {
  const rows = db
    .select({ printerId: s.printJobs.printerId, status: s.printJobs.status })
    .from(s.printJobs)
    .where(inArray(s.printJobs.status, ['pending', 'printing', 'failed']))
    .all()
  const by: Record<string, { pending: number; failed: number }> = {}
  for (const r of rows) {
    const c = (by[r.printerId] ??= { pending: 0, failed: 0 })
    if (r.status === 'failed') c.failed++
    else c.pending++
  }
  return by
}

function job(id: string) {
  const j = db.select().from(s.printJobs).where(eq(s.printJobs.id, id)).get()
  if (!j) throw notFound('print job')
  return j
}

/** Send one job again. Failed or discarded only: a pending one is already queued. */
export function retryPrintJob(id: string, employeeId: string) {
  const j = job(id)
  if (j.status !== 'failed' && j.status !== 'discarded') {
    throw conflict(j.status === 'done' ? 'That job already printed.' : 'That job is already in the queue.')
  }
  db.update(s.printJobs).set({ status: 'pending', attempts: 0, lastError: null }).where(eq(s.printJobs.id, id)).run()
  audit(employeeId, 'print_job.retry', 'print_job', id, { kind: j.kind, was: j.status })
  printQueue.kick(j.printerId)
  return { id, status: 'pending' as const }
}

/**
 * Give up on a job: the kitchen was told by voice, or the printer is gone.
 * Not while it is on the wire — that could print and still show discarded.
 */
export function discardPrintJob(id: string, employeeId: string) {
  const j = job(id)
  if (j.status === 'printing') throw conflict('That job is printing right now. Try again in a moment.')
  if (j.status !== 'pending' && j.status !== 'failed') throw conflict('Only waiting or failed jobs can be discarded.')
  db.update(s.printJobs).set({ status: 'discarded', completedAt: new Date() }).where(eq(s.printJobs.id, id)).run()
  audit(employeeId, 'print_job.discard', 'print_job', id, { kind: j.kind, was: j.status, lastError: j.lastError })
  return { id, status: 'discarded' as const }
}
