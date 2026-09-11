import { newId, schema } from '@pos/shared'
import { db } from './db.js'

/**
 * Every discount, void, waiter reassignment and no-KOT save lands here.
 * This is the anti-theft feature the owner is actually buying.
 */
export function audit(
  employeeId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  detail?: unknown,
): void {
  db.insert(schema.auditLog).values({
    id: newId(),
    employeeId,
    action,
    entity,
    entityId,
    detailJson: detail === undefined ? null : JSON.stringify(detail),
  }).run()
}
