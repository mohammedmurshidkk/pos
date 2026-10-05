import { and, asc, eq, inArray } from 'drizzle-orm'
import { schema } from '@pos/shared'
import { db } from './db.js'
import { deliver } from './printer.js'
import { renderJob } from './templates.js'

const { printJobs, printers } = schema

const MAX_ATTEMPTS = 5
/** Backoff per attempt, ms. Short at first — a printer is usually just busy. */
const BACKOFF = [0, 1_000, 3_000, 8_000, 20_000]

type Listener = (event: { type: string; payload: unknown }) => void

/**
 * Print queue.
 *
 * ONE SERIAL WORKER PER PRINTER. ESC/POS has no multiplexing — two concurrent
 * sockets to the same printer produce shredded output. Jobs for different
 * printers run in parallel; jobs for the same printer never do.
 *
 * Nothing here ever blocks an order being taken. Enqueue commits with the
 * order; printing happens after, and failures surface on the cashier PC.
 */
class PrintQueue {
  private running = new Set<string>()
  private timers = new Map<string, NodeJS.Timeout>()
  private listeners = new Set<Listener>()

  onEvent(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(type: string, payload: unknown) {
    for (const l of this.listeners) l({ type, payload })
  }

  /** Called after a job row is inserted. Returns immediately. */
  kick(printerId: string): void {
    // Tests and dry runs assert on queued jobs without waiting on absent hardware.
    if (process.env.POS_PRINT_DISABLED === '1') return
    if (this.running.has(printerId)) return
    void this.drain(printerId)
  }

  /** Kick every printer that has pending work — used on boot and on retry-all. */
  async kickAll(): Promise<void> {
    if (process.env.POS_PRINT_DISABLED === '1') return
    const pending = await db
      .selectDistinct({ printerId: printJobs.printerId })
      .from(printJobs)
      .where(inArray(printJobs.status, ['pending']))
    for (const p of pending) this.kick(p.printerId)
  }

  private async drain(printerId: string): Promise<void> {
    this.running.add(printerId)
    try {
      for (;;) {
        const [job] = await db
          .select()
          .from(printJobs)
          .where(and(eq(printJobs.printerId, printerId), eq(printJobs.status, 'pending')))
          .orderBy(asc(printJobs.createdAt))
          .limit(1)
        if (!job) break

        const [printer] = await db.select().from(printers).where(eq(printers.id, printerId)).limit(1)
        if (!printer || !printer.enabled) {
          await db
            .update(printJobs)
            .set({ status: 'failed', lastError: 'printer missing or disabled' })
            .where(eq(printJobs.id, job.id))
          continue
        }

        await db.update(printJobs).set({ status: 'printing' }).where(eq(printJobs.id, job.id))

        try {
          const payload = renderJob(job.kind, JSON.parse(job.payloadJson), printer.width)
          await deliver(printer, payload)
          await db
            .update(printJobs)
            .set({ status: 'done', completedAt: new Date(), attempts: job.attempts + 1 })
            .where(eq(printJobs.id, job.id))
          this.emit('print.done', { jobId: job.id, printerId })
        } catch (err) {
          const attempts = job.attempts + 1
          const failed = attempts >= MAX_ATTEMPTS
          await db
            .update(printJobs)
            .set({
              status: failed ? 'failed' : 'pending',
              attempts,
              lastError: err instanceof Error ? err.message : String(err),
            })
            .where(eq(printJobs.id, job.id))

          this.emit(failed ? 'print.failed' : 'print.retry', {
            jobId: job.id,
            printerId,
            printerName: printer.name,
            attempts,
            error: err instanceof Error ? err.message : String(err),
          })

          if (failed) continue
          // Back off, then come back to this printer. Other printers keep running.
          this.schedule(printerId, BACKOFF[Math.min(attempts, BACKOFF.length - 1)]!)
          break
        }
      }
    } finally {
      this.running.delete(printerId)
    }
  }

  private schedule(printerId: string, ms: number) {
    clearTimeout(this.timers.get(printerId))
    this.timers.set(
      printerId,
      setTimeout(() => {
        this.timers.delete(printerId)
        this.kick(printerId)
      }, ms),
    )
  }

  /** Admin "Retry all" — puts failed jobs back in the queue. */
  async retryFailed(printerId?: string): Promise<number> {
    const where = printerId
      ? and(eq(printJobs.status, 'failed'), eq(printJobs.printerId, printerId))
      : eq(printJobs.status, 'failed')
    const rows = await db.select({ id: printJobs.id, printerId: printJobs.printerId }).from(printJobs).where(where)
    if (rows.length === 0) return 0
    await db.update(printJobs).set({ status: 'pending', attempts: 0, lastError: null }).where(where)
    for (const id of new Set(rows.map((r) => r.printerId))) this.kick(id)
    return rows.length
  }
}

export const printQueue = new PrintQueue()
