import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db } from '../db.js'
import { conflict, forbidden, notFound } from '../errors.js'
import { hashPin, verifyPin } from './auth.js'

const s = schema

/**
 * Superadmin — the way back in when admin PINs are lost.
 *
 * Deliberately NOT an employee row: it takes no orders, appears on no report and
 * is never picked from a list. It exists to manage the admins of this one unit,
 * and nothing else.
 *
 * It is reachable only from the counter PC — the access hook keeps every route
 * here off the tablet allowlist, so a paired tablet gets 403 no matter what
 * password it knows.
 */

/** Sliding session: long enough to fix an admin, short enough to walk away from. */
const SESSION_MS = 30 * 60_000
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 60_000
const MIN_PASSWORD = 8

const sessions = new Map<string, number>()
const attempts = new Map<string, { count: number; until: number }>()

function settingsRow() {
  const row = db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()
  if (!row) throw new Error('settings missing — the hub has not been seeded')
  return row
}

/** Is a superadmin password set at all? The UI needs this before offering the door. */
export const superadminConfigured = () => settingsRow().superadminHash != null

export function superadminLogin(password: string, clientKey: string) {
  const lock = attempts.get(clientKey)
  if (lock && lock.until > Date.now()) {
    throw forbidden(`Too many attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 1000)} seconds.`)
  }

  const hash = settingsRow().superadminHash
  if (!hash) {
    throw forbidden('No superadmin password is set on this installation. Set one with `pnpm superadmin:set` on this PC.')
  }

  if (!verifyPin(password, hash)) {
    const count = (lock?.count ?? 0) + 1
    attempts.set(clientKey, { count, until: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0 })
    audit(null, 'superadmin.failed', 'settings', 'singleton', { attempt: count })
    throw forbidden('Wrong password.')
  }

  attempts.delete(clientKey)
  const token = randomBytes(24).toString('base64url')
  sessions.set(token, Date.now() + SESSION_MS)
  audit(null, 'superadmin.login', 'settings', 'singleton', null)
  return { token, expiresAt: new Date(Date.now() + SESSION_MS).toISOString() }
}

/** Throws unless the token is live. Extends it — the clock runs from last use. */
export function requireSuperadmin(token: string | undefined | null) {
  const expiry = token ? sessions.get(token) : undefined
  if (!token || !expiry || expiry < Date.now()) {
    if (token) sessions.delete(token)
    throw forbidden('That superadmin session has ended. Enter the password again.')
  }
  sessions.set(token, Date.now() + SESSION_MS)
}

export function superadminLogout(token: string | undefined | null) {
  if (token) sessions.delete(token)
  return { ok: true }
}

/* ─────────────────────── managing this unit's admins ─────────────────────── */

export function listAdmins() {
  return db
    .select({
      id: s.employees.id,
      name: s.employees.name,
      active: s.employees.active,
      canDiscount: s.employees.canDiscount,
      maxDiscountPercent: s.employees.maxDiscountPercent,
      pinHash: s.employees.pinHash,
      createdAt: s.employees.createdAt,
    })
    .from(s.employees)
    .where(eq(s.employees.role, 'admin'))
    .all()
    // Never ship the hash — only whether a PIN exists.
    .map(({ pinHash, ...rest }) => ({ ...rest, hasPin: pinHash != null }))
}

const assertPin = (pin: string) => {
  if (!/^\d{4,6}$/.test(pin)) throw conflict('A PIN must be 4 to 6 digits.')
}

export function createAdmin(input: { name: string; pin: string }) {
  const name = input.name.trim()
  if (!name) throw conflict('Name is required.')
  assertPin(input.pin)
  const clash = db.select().from(s.employees).all()
    .find((e) => e.name.toLowerCase() === name.toLowerCase())
  if (clash) throw conflict(`"${name}" already exists.`)

  const id = newId()
  db.insert(s.employees).values({
    id, name, role: 'admin', pinHash: hashPin(input.pin),
    canDiscount: true, maxDiscountPercent: 100, canSaveWithoutKot: true,
  }).run()
  audit(null, 'superadmin.create_admin', 'employees', id, { name })
  return listAdmins().find((a) => a.id === id)!
}

/** The whole point of the feature: an admin has forgotten their PIN. */
export function resetAdminPin(id: string, pin: string) {
  assertPin(pin)
  const row = db.select().from(s.employees).where(eq(s.employees.id, id)).get()
  if (!row || row.role !== 'admin') throw notFound('admin')

  db.update(s.employees).set({ pinHash: hashPin(pin) }).where(eq(s.employees.id, id)).run()
  // The PIN itself is never written to the log.
  audit(null, 'superadmin.reset_pin', 'employees', id, { name: row.name })
  return { ok: true }
}

export function setAdminActive(id: string, active: boolean) {
  const row = db.select().from(s.employees).where(eq(s.employees.id, id)).get()
  if (!row || row.role !== 'admin') throw notFound('admin')

  if (!active) {
    // Disabling the last one would lock every human out of the counter, and
    // only a superadmin could undo it. Refuse rather than create that state.
    const others = db.select().from(s.employees)
      .where(and(eq(s.employees.role, 'admin'), eq(s.employees.active, true))).all()
      .filter((e) => e.id !== id && e.pinHash != null)
    if (others.length === 0) {
      throw conflict('This is the last admin who can sign in. Add another one before disabling this one.')
    }
  }

  db.update(s.employees).set({ active }).where(eq(s.employees.id, id)).run()
  audit(null, active ? 'superadmin.enable_admin' : 'superadmin.disable_admin', 'employees', id, { name: row.name })
  return { ok: true }
}

export function setSuperadminPassword(password: string) {
  if (password.length < MIN_PASSWORD) {
    throw conflict(`The superadmin password must be at least ${MIN_PASSWORD} characters.`)
  }
  db.update(s.settings).set({ superadminHash: hashPin(password) }).where(eq(s.settings.id, 'singleton')).run()
  audit(null, 'superadmin.password_changed', 'settings', 'singleton', null)
  return { ok: true }
}

/** Test seam — module state would otherwise leak between test files. */
export function _resetSuperadminState() {
  sessions.clear()
  attempts.clear()
}
