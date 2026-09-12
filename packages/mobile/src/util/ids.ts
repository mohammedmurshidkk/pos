/**
 * Client-generated batch id.
 *
 * Not a UUID library — this only needs to be unique per tablet per send, and
 * pulling in a dependency for that is not worth it. Time prefix keeps it
 * sortable, which helps when reading the audit log.
 */
export function newBatchRef(): string {
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `b_${time}_${rand}`
}
