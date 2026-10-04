import { and, desc, eq, gte, lt } from 'drizzle-orm'
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
    })
    .from(s.expenses)
    .innerJoin(s.expenseCategories, eq(s.expenses.expenseCategoryId, s.expenseCategories.id))
    .innerJoin(s.employees, eq(s.expenses.paidBy, s.employees.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(s.expenses.createdAt))
    .all()
}
