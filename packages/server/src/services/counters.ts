import { schema as s } from '@pos/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db.js'
import { notFound } from '../errors.js'

/**
 * Resolve the counter an action is happening at, or fail with a usable message.
 *
 * `payments.counter_id` is a foreign key, so a counter id the client made up —
 * or one left over from before the database was re-seeded — fails inside the
 * settle transaction as `SqliteError: FOREIGN KEY constraint failed` and escapes
 * as a bare 500. The insert carries four foreign keys at once (order, payment
 * mode, counter, shift) and SQLite does not say which one broke, so an unchecked
 * counter id is indistinguishable from any other cause in the log.
 *
 * See [[requireEmployee]] in ./employees.ts — same problem, same treatment.
 */
export function requireCounter(counterId: string) {
  const counter = db.select().from(s.counters).where(eq(s.counters.id, counterId)).get()
  // Name the id: on site this is diagnosed over the phone, and "counter not found"
  // alone cannot distinguish a stale client from a genuinely missing row.
  if (!counter) throw notFound(`counter ${counterId}`)
  return counter
}
