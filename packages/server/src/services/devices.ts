import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import os from 'node:os'
import { eq } from 'drizzle-orm'
import { newId, schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db } from '../db.js'
import { conflict, forbidden, notFound } from '../errors.js'

const s = schema

/** A pairing code is typed by hand once, so short-lived and single-use. */
const CODE_TTL_MS = 10 * 60_000
const MAX_PAIR_FAILURES = 5
const PAIR_LOCKOUT_MS = 60_000
/** Writing last_seen on every request would be a write per tap; once a minute is plenty. */
const LAST_SEEN_THROTTLE_MS = 60_000

let activeCode: { code: string; expiresAt: number } | null = null
const failures = new Map<string, { count: number; until: number }>()

/**
 * Tokens are stored hashed. SHA-256 is enough here: the token is 256 random
 * bits, so unlike a PIN there is nothing to brute-force from the hash.
 */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/**
 * Issue a pairing code on the counter PC. Issuing a new one cancels the old one,
 * so a code read off the screen yesterday is worthless today.
 */
export function createPairingCode(employeeId: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  activeCode = { code, expiresAt: Date.now() + CODE_TTL_MS }
  audit(employeeId, 'device.code_issued', 'devices', null, null)
  return { code, expiresAt: new Date(activeCode.expiresAt).toISOString() }
}

export function cancelPairingCode() {
  activeCode = null
}

/**
 * Exchange a pairing code for a long-lived device token.
 *
 * `clientKey` is the caller's address. Six digits is a million guesses; five
 * wrong tries a minute over a ten-minute code window makes guessing it hopeless.
 */
export function pairDevice(input: { code: string; name?: string }, clientKey: string) {
  const lock = failures.get(clientKey)
  if (lock && lock.until > Date.now()) {
    throw forbidden(`Too many wrong codes. Try again in ${Math.ceil((lock.until - Date.now()) / 1000)} seconds.`)
  }

  const fail = (msg: string): never => {
    const count = (lock?.count ?? 0) + 1
    failures.set(clientKey, { count, until: count >= MAX_PAIR_FAILURES ? Date.now() + PAIR_LOCKOUT_MS : 0 })
    throw forbidden(msg)
  }

  const code = String(input.code ?? '').trim()
  if (!activeCode || activeCode.expiresAt < Date.now()) {
    activeCode = null
    fail('No pairing code is active. On the counter PC open Devices → Pair a tablet.')
  }
  const expected = Buffer.from(activeCode!.code)
  const given = Buffer.from(code.padEnd(expected.length).slice(0, expected.length))
  if (code.length !== expected.length || !timingSafeEqual(expected, given)) {
    fail('That pairing code is wrong or has expired.')
  }

  // Single use: the code is spent the moment it succeeds.
  activeCode = null
  failures.delete(clientKey)

  const token = randomBytes(32).toString('base64url')
  const id = newId()
  const name = (input.name ?? '').trim().slice(0, 40) || `Tablet ${listDevices().length + 1}`
  db.insert(s.devices).values({
    id, name, type: 'tablet', pairToken: hashToken(token), lastSeen: new Date(),
  }).run()
  audit(null, 'device.paired', 'devices', id, { name })

  // The only time the token ever leaves the hub.
  return { deviceId: id, name, token }
}

/** Resolve a presented token to an active device, or null. */
export function authenticateDevice(token: string | undefined | null) {
  if (!token) return null
  const row = db.select().from(s.devices).where(eq(s.devices.pairToken, hashToken(token))).get()
  if (!row || !row.active) return null

  const seen = row.lastSeen?.getTime() ?? 0
  if (Date.now() - seen > LAST_SEEN_THROTTLE_MS) {
    db.update(s.devices).set({ lastSeen: new Date() }).where(eq(s.devices.id, row.id)).run()
  }
  return { id: row.id, name: row.name }
}

export function listDevices() {
  return db.select({
    id: s.devices.id,
    name: s.devices.name,
    type: s.devices.type,
    lastSeen: s.devices.lastSeen,
    active: s.devices.active,
    createdAt: s.devices.createdAt,
  }).from(s.devices).all()
}

/** Revoking takes effect on the tablet's very next request. */
export function revokeDevice(id: string, employeeId: string) {
  const row = db.select().from(s.devices).where(eq(s.devices.id, id)).get()
  if (!row) throw notFound('device')
  if (!row.active) throw conflict('That device is already unpaired.')
  db.update(s.devices).set({ active: false }).where(eq(s.devices.id, id)).run()
  audit(employeeId, 'device.revoked', 'devices', id, { name: row.name })
  return { revoked: true }
}

/**
 * The addresses a tablet could reach this hub on, so the pairing screen can say
 * "enter 192.168.1.10" instead of making the installer find the PC's IP.
 */
export function hubAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
}

/** Test seam — module state would otherwise leak between test files. */
export function _resetPairingState() {
  activeCode = null
  failures.clear()
}
