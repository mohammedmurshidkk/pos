import { and, desc, eq, like, or } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { db, raw } from '../db.js'
import { conflict, notFound } from '../errors.js'

const s = schema

/**
 * One customer per phone number.
 *
 * Staff type numbers every way: "050 123 4567", "050-1234567", "+971 50…".
 * Keeping only the digits (and dropping an international "00") makes those
 * spacing variants one customer. It does not try to guess country codes, so
 * "0501234567" and "971501234567" stay two — guessing wrong would merge two
 * real people.
 */
export function normalizePhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.startsWith('00') ? digits.slice(2) : digits
}

const MIN_DIGITS = 5

function addressesOf(customerId: string) {
  // Newest first: the address used last is the likeliest one this time.
  return raw
    .prepare('select notes from customer_addresses where customer_id = ? and notes is not null order by rowid desc')
    .all(customerId)
    .map((r) => (r as { notes: string }).notes)
}

function summary(c: typeof s.customers.$inferSelect) {
  const stats = raw
    .prepare(`select count(*) as n, max(opened_at) as last from orders where customer_id = ? and status != 'void'`)
    .get(c.id) as { n: number; last: number | null }
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    addresses: addressesOf(c.id),
    orderCount: stats.n,
    lastOrderAt: stats.last ? new Date(stats.last).toISOString() : null,
  }
}

export type CustomerSummary = ReturnType<typeof summary>

/** Delivery lookup: phone first, then name and saved addresses fill themselves in. */
export function findCustomerByPhone(phone: string): CustomerSummary | null {
  const p = normalizePhone(phone)
  if (p.length < MIN_DIGITS) return null
  const c = db.select().from(s.customers).where(eq(s.customers.phone, p)).get()
  return c ? summary(c) : null
}

/** Search by part of a phone number or a name. A branch has thousands at most. */
export function searchCustomers(q: string, limit = 20): CustomerSummary[] {
  const text = q.trim()
  if (!text) return []
  const digits = normalizePhone(text)
  const rows = db
    .select()
    .from(s.customers)
    .where(or(
      like(s.customers.name, `%${text}%`),
      ...(digits.length >= 3 ? [like(s.customers.phone, `%${digits}%`)] : []),
    ))
    .orderBy(desc(s.customers.createdAt))
    .limit(limit)
    .all()
  return rows.map(summary)
}

/**
 * Create or update the customer for a phone number and return their id.
 *
 * A name given now replaces the stored one (people correct spellings). An
 * address is saved once per distinct text. A blank name never wipes a known
 * one. Returns null when there is no usable phone number: a name alone is
 * kept on the order but is not a customer record, and so is a number too
 * short to be real.
 */
export function saveCustomer(
  input: { phone?: string | null; name?: string | null; address?: string | null },
  /** Refuse a too-short number instead of quietly skipping the record. */
  strict = false,
): string | null {
  const phone = normalizePhone(input.phone)
  if (!phone) return null
  if (phone.length < MIN_DIGITS) {
    // A queued tablet order must never fail on a typo, so only the counter's
    // settle step, where someone is looking at the screen, refuses.
    if (strict) throw conflict('That phone number looks too short.')
    return null
  }
  const name = input.name?.trim() || null
  const address = input.address?.trim() || null

  return raw.transaction(() => {
    const existing = db.select().from(s.customers).where(eq(s.customers.phone, phone)).get()
    let id: string
    if (existing) {
      id = existing.id
      if (name && name !== existing.name) {
        db.update(s.customers).set({ name }).where(eq(s.customers.id, id)).run()
      }
    } else {
      id = newId()
      db.insert(s.customers).values({ id, phone, name: name ?? '' }).run()
    }
    if (address) {
      const known = db
        .select({ id: s.customerAddresses.id })
        .from(s.customerAddresses)
        .where(and(eq(s.customerAddresses.customerId, id), eq(s.customerAddresses.notes, address)))
        .get()
      if (!known) {
        db.insert(s.customerAddresses).values({ id: newId(), customerId: id, label: 'Home', notes: address }).run()
      }
    }
    return id
  })()
}

/**
 * Put a name and phone on an order and link it to the customer record.
 * Used at settle time, when the cashier asks; also fine on a settled bill.
 */
export function attachCustomer(orderId: string, input: { phone?: string | null; name?: string | null }) {
  const order = db.select().from(s.orders).where(eq(s.orders.id, orderId)).get()
  if (!order) throw notFound('order')
  const name = input.name?.trim() || null
  const phone = normalizePhone(input.phone) || null
  if (!name && !phone) return
  const customerId = saveCustomer({ phone, name }, true)
  db.update(s.orders).set({
    ...(name ? { customerName: name } : {}),
    ...(phone ? { phoneSnapshot: phone } : {}),
    ...(customerId ? { customerId } : {}),
  }).where(eq(s.orders.id, orderId)).run()
}
