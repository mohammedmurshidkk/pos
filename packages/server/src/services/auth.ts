import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db } from '../db.js'
import { forbidden, notFound } from '../errors.js'

const s = schema

/**
 * PINs are hashed with scrypt, never stored in the clear.
 *
 * A four-digit PIN is weak by design — it is typed fifty times a shift. What it
 * protects against is a waiter settling a bill as the manager, not a determined
 * attacker, and the machine sits behind the counter. Hashing still matters:
 * the database gets copied to a USB stick on every shift close.
 */
export function hashPin(pin: string): string {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(pin, salt, 32).toString('hex')}`
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [alg, saltHex, keyHex] = stored.split('$')
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false
  const expected = Buffer.from(keyHex, 'hex')
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length)
  // Constant-time: a length-varying compare would leak the prefix.
  return timingSafeEqual(actual, expected)
}

/**
 * Failed attempts, in memory only.
 *
 * Enough to stop someone standing at the till working through 0000-9999; it
 * resets when the hub restarts, which is the right trade for a shop where
 * locking the manager out mid-service is worse than the attack.
 */
const attempts = new Map<string, { count: number; until: number }>()
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 30_000

export function login(employeeId: string, pin: string) {
  const employee = db.select().from(s.employees).where(eq(s.employees.id, employeeId)).get()
  if (!employee || !employee.active) throw notFound('employee')

  // The counter settles money, discounts and voids — waiters use the tablet,
  // which needs no login at all.
  if (employee.role !== 'admin') {
    throw forbidden(`${employee.name} is a waiter. Only admins can sign in at the counter.`)
  }

  const record = attempts.get(employeeId)
  if (record && record.until > Date.now()) {
    const secs = Math.ceil((record.until - Date.now()) / 1000)
    throw forbidden(`Too many wrong PINs. Try again in ${secs} seconds.`)
  }

  if (!employee.pinHash) {
    throw forbidden(`${employee.name} has no PIN set. Set one under Setup → Employees.`)
  }

  if (!verifyPin(pin, employee.pinHash)) {
    const count = (record?.count ?? 0) + 1
    attempts.set(employeeId, {
      count,
      until: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
    })
    audit(null, 'auth.failed', 'employee', employeeId, { attempt: count })
    throw forbidden('Wrong PIN.')
  }

  attempts.delete(employeeId)
  audit(employee.id, 'auth.login', 'employee', employee.id, null)
  return {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    canDiscount: employee.canDiscount,
    maxDiscountPercent: employee.maxDiscountPercent,
    canSaveWithoutKot: employee.canSaveWithoutKot,
  }
}

export function setPin(employeeId: string, pin: string, byEmployeeId: string) {
  if (!/^\d{4,6}$/.test(pin)) throw forbidden('A PIN must be 4 to 6 digits.')
  const employee = db.select().from(s.employees).where(eq(s.employees.id, employeeId)).get()
  if (!employee) throw notFound('employee')

  db.update(s.employees).set({ pinHash: hashPin(pin) }).where(eq(s.employees.id, employeeId)).run()
  audit(byEmployeeId, 'auth.set_pin', 'employee', employeeId, null)
  return { ok: true }
}
