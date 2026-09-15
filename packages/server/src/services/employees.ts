import { schema as s } from '@pos/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db.js'
import { notFound } from '../errors.js'

/**
 * Resolve the employee behind an action, or fail with a message the client can show.
 *
 * Almost every write stamps an employee id — payments.created_by, orders.created_by,
 * order_items.created_by, expenses.paid_by, shifts.employee_id, audit_log.employee_id —
 * and every one of those columns is a foreign key. An id that no longer exists therefore
 * surfaces as `SqliteError: FOREIGN KEY constraint failed`, which is not an AppError, so
 * it escapes the error mapping as a bare 500 with "Something went wrong." The cause is
 * invisible from the client and from the network tab alike.
 *
 * This happens for two ordinary reasons, not just bad clients: re-seeding regenerates
 * every employee id while a browser still holds the old one in sessionStorage, and an
 * employee deactivated mid-shift keeps their id in a screen that is already open.
 *
 * Call this before the write, so the caller gets 404 "employee not found" instead.
 */
export function requireEmployee(employeeId: string) {
  const employee = db.select().from(s.employees).where(eq(s.employees.id, employeeId)).get()
  // Name the id: on site this is diagnosed over the phone, and "employee not found"
  // alone cannot distinguish a stale client from a genuinely missing row.
  if (!employee) throw notFound(`employee ${employeeId}`)
  return employee
}
