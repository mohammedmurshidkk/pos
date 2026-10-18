import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db } from '../db.js'
import { conflict, notFound } from '../errors.js'
import { openShiftIdFor } from './shifts.js'
import { requireCounter } from './counters.js'
import { requireEmployee } from './employees.js'

const s = schema

/**
 * Record an expense.
 *
 * `paidFromDrawer` defaults on during an open shift — that is what makes the
 * Z-report variance correct. An expense paid from the drawer that isn't
 * recorded shows up as cash missing.
 */
export function createExpense(input: {
  expenseCategoryId: string
  amount: number
  note?: string | null
  paidBy: string
  counterId?: string | null
  paidFromDrawer?: boolean
}) {
  if (input.amount <= 0) throw conflict('Expense amount must be positive.')
  const cat = db.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, input.expenseCategoryId)).get()
  if (!cat) throw notFound('expense category')
  requireEmployee(input.paidBy)
  if (input.counterId) requireCounter(input.counterId)

  const shiftId = input.counterId ? openShiftIdFor(input.counterId) : null
  // Without an open shift there is no drawer to pay from.
  const paidFromDrawer = (input.paidFromDrawer ?? true) && shiftId != null

  const id = newId()
  db.insert(s.expenses).values({
    id,
    expenseCategoryId: input.expenseCategoryId,
    amount: input.amount,
    note: input.note ?? null,
    paidBy: input.paidBy,
    shiftId,
    paidFromDrawer,
  }).run()

  audit(input.paidBy, 'expense.create', 'expense', id, {
    amount: input.amount, category: cat.name, paidFromDrawer,
  })
  return db.select().from(s.expenses).where(eq(s.expenses.id, id)).get()!
}

/**
 * Expenses newest first. `to` is exclusive, matching the report ranges, so
 * "today" never picks up the first minute of tomorrow's business day.
 */
export function listExpenses(opts: { from?: Date; to?: Date; categoryId?: string | null } = {}) {
  const where = [
    isNull(s.expenses.deletedAt),
    opts.from ? gte(s.expenses.createdAt, opts.from) : undefined,
    opts.to ? lt(s.expenses.createdAt, opts.to) : undefined,
    opts.categoryId ? eq(s.expenses.expenseCategoryId, opts.categoryId) : undefined,
  ].filter((w) => w !== undefined)
  return db
    .select({
      id: s.expenses.id,
      amount: s.expenses.amount,
      note: s.expenses.note,
      paidFromDrawer: s.expenses.paidFromDrawer,
      shiftId: s.expenses.shiftId,
      createdAt: s.expenses.createdAt,
      categoryId: s.expenses.expenseCategoryId,
      category: s.expenseCategories.name,
      paidBy: s.employees.name,
      shiftClosedAt: s.shifts.closedAt,
    })
    .from(s.expenses)
    .innerJoin(s.expenseCategories, eq(s.expenses.expenseCategoryId, s.expenseCategories.id))
    .innerJoin(s.employees, eq(s.expenses.paidBy, s.employees.id))
    .leftJoin(s.shifts, eq(s.expenses.shiftId, s.shifts.id))
    .where(and(...where))
    .orderBy(desc(s.expenses.createdAt))
    .all()
    // Same rule as requireEditable: only while its shift is still open.
    .map(({ shiftClosedAt, ...r }) => ({ ...r, editable: r.shiftId != null && shiftClosedAt == null }))
}

/**
 * An expense can be changed only while the shift it was paid in is still
 * open. Once the shift closes its Z-report is printed and the drawer counted,
 * so changing the expense afterwards would make the paper disagree with the
 * books. An expense recorded with no shift has no drawer to correct.
 */
function requireEditable(id: string) {
  const row = db.select().from(s.expenses).where(eq(s.expenses.id, id)).get()
  if (!row || row.deletedAt) throw notFound('expense')
  const shift = row.shiftId
    ? db.select().from(s.shifts).where(eq(s.shifts.id, row.shiftId)).get()
    : undefined
  if (!shift || shift.closedAt) {
    throw conflict('This expense belongs to a closed shift and can no longer be changed.')
  }
  return row
}

/**
 * Correct an expense: category, amount, note, or whether it came from the
 * drawer. The Z-report and expected cash are computed from the rows, so they
 * follow the change with nothing else to update. The audit row keeps the
 * before and after values.
 */
export function updateExpense(id: string, input: {
  employeeId: string
  expenseCategoryId?: string
  amount?: number
  note?: string | null
  paidFromDrawer?: boolean
}) {
  requireEmployee(input.employeeId)
  const row = requireEditable(id)
  const amount = input.amount ?? row.amount
  if (!Number.isInteger(amount) || amount <= 0) throw conflict('Expense amount must be positive.')
  const expenseCategoryId = input.expenseCategoryId ?? row.expenseCategoryId
  const cat = db.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, expenseCategoryId)).get()
  if (!cat) throw notFound('expense category')
  const note = input.note === undefined ? row.note : (input.note?.trim() || null)
  const paidFromDrawer = input.paidFromDrawer ?? row.paidFromDrawer

  const before = { amount: row.amount, categoryId: row.expenseCategoryId, note: row.note, paidFromDrawer: row.paidFromDrawer }
  const after = { amount, categoryId: expenseCategoryId, note, paidFromDrawer }
  db.update(s.expenses).set({ amount, expenseCategoryId, note, paidFromDrawer }).where(eq(s.expenses.id, id)).run()

  audit(input.employeeId, 'expense.update', 'expense', id, { before, after, category: cat.name })
  return db.select().from(s.expenses).where(eq(s.expenses.id, id)).get()!
}

/**
 * Remove an expense recorded by mistake. The row is kept, marked deleted, so
 * the audit trail can still point at it; every total skips it from now on.
 */
export function deleteExpense(id: string, input: { employeeId: string }) {
  requireEmployee(input.employeeId)
  const row = requireEditable(id)
  db.update(s.expenses)
    .set({ deletedAt: new Date(), deletedBy: input.employeeId })
    .where(eq(s.expenses.id, id))
    .run()
  audit(input.employeeId, 'expense.delete', 'expense', id, {
    amount: row.amount, categoryId: row.expenseCategoryId, note: row.note,
    paidFromDrawer: row.paidFromDrawer,
  })
  return { deleted: true }
}
