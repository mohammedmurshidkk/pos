import { uuidv7 } from 'uuidv7'

/**
 * All primary keys are UUIDv7: time-sortable, generated offline on any device,
 * no collisions, no sequence coordination with the hub.
 */
export const newId = (): string => uuidv7()
