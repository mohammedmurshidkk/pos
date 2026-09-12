import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db } from '../db.js'
import { conflict, notFound } from '../errors.js'
import { openShiftIdFor } from './shifts.js'

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
  const emp = db.select().from(s.employees).where(eq(s.employees.id, input.paidBy)).get()
  if (!emp) throw notFound('employee')

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

export function listExpenses(from?: Date, to?: Date) {
  const rows = db
    .select({
      id: s.expenses.id,
      amount: s.expenses.amount,
      note: s.expenses.note,
      paidFromDrawer: s.expenses.paidFromDrawer,
      createdAt: s.expenses.createdAt,
      category: s.expenseCategories.name,
      paidBy: s.employees.name,
    })
    .from(s.expenses)
    .innerJoin(s.expenseCategories, eq(s.expenses.expenseCategoryId, s.expenseCategories.id))
    .innerJoin(s.employees, eq(s.expenses.paidBy, s.employees.id))
    .where(from && to ? and(gte(s.expenses.createdAt, from), lte(s.expenses.createdAt, to)) : undefined)
    .orderBy(desc(s.expenses.createdAt))
    .all()
  return rows
}
