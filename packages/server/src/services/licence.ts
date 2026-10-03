import { createPublicKey, randomUUID, verify } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { schema } from '@pos/shared'
import { audit } from '../audit.js'
import { db } from '../db.js'
import { conflict, licenceRequired } from '../errors.js'
import { LICENCE_PUBLIC_KEY } from '../licence-public-key.js'

const s = schema
const DAY = 86_400_000

/** Length of the automatic trial that starts on first run. */
export const TRIAL_DAYS = 30
/** Start warning this many days before expiry. */
export const WARN_DAYS = 7
/** Clock skew we tolerate before calling it a rollback (NTP drift, DST). */
const SKEW_MS = 10 * 60_000

export interface LicencePayload {
  v: 1
  installId: string
  customer: string
  plan: 'paid' | 'trial'
  issuedAt: number
  expiresAt: number
}

export interface LicenceStatus {
  state: 'trial' | 'active' | 'expired'
  plan: 'trial' | 'paid'
  customer: string | null
  installId: string
  expiresAt: string
  daysLeft: number
  /** Within WARN_DAYS of expiry, or already expired. */
  warning: boolean
  /** The PC clock is behind a time we have already seen. */
  clockRolledBack: boolean
}

const publicKey = () => createPublicKey(process.env.POS_LICENCE_PUBLIC_KEY ?? LICENCE_PUBLIC_KEY)

/** Verify signature and shape. Returns the payload or a human-readable reason. */
export function parseLicence(key: string): { payload: LicencePayload } | { error: string } {
  const [prefix, body, sig] = key.trim().split('.')
  if (prefix !== 'POS1' || !body || !sig) return { error: 'That is not a licence key.' }

  let ok = false
  try {
    ok = verify(null, Buffer.from(body), publicKey(), Buffer.from(sig, 'base64url'))
  } catch {
    ok = false
  }
  // Checked before decoding: never trust a payload whose signature failed.
  if (!ok) return { error: 'That licence key is not valid.' }

  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LicencePayload
    if (p.v !== 1 || typeof p.installId !== 'string' || typeof p.expiresAt !== 'number') {
      return { error: 'That licence key is from an unsupported version.' }
    }
    return { payload: p }
  } catch {
    return { error: 'That licence key is damaged.' }
  }
}

function settingsRow() {
  const row = db.select().from(s.settings).where(eq(s.settings.id, 'singleton')).get()
  if (!row) throw new Error('settings missing — the hub has not been seeded')
  return row
}

/**
 * Current licence state.
 *
 * Lazily creates the install id and starts the trial clock the first time it is
 * asked, so existing databases pick licensing up without a data migration.
 */
export function licenceStatus(now = Date.now()): LicenceStatus {
  const row = settingsRow()
  const patch: Partial<typeof s.settings.$inferInsert> = {}

  const installId = row.installId ?? randomUUID()
  if (!row.installId) patch.installId = installId
  const trialStartedAt = row.trialStartedAt?.getTime() ?? now
  if (!row.trialStartedAt) patch.trialStartedAt = new Date(now)

  // Winding the clock back must not rewind the expiry, so the effective "now" is
  // never earlier than the latest moment this install has already lived through.
  const highWater = row.clockHighWater?.getTime() ?? now
  const clockRolledBack = now < highWater - SKEW_MS
  const effectiveNow = Math.max(now, highWater)
  // Only move the mark forward, and not on every request.
  if (now > highWater + 60_000 || !row.clockHighWater) patch.clockHighWater = new Date(Math.max(now, highWater))

  if (Object.keys(patch).length > 0) {
    db.update(s.settings).set(patch).where(eq(s.settings.id, 'singleton')).run()
  }

  let plan: 'trial' | 'paid' = 'trial'
  let customer: string | null = null
  let expiresAt = trialStartedAt + TRIAL_DAYS * DAY

  if (row.licenceKey) {
    const parsed = parseLicence(row.licenceKey)
    // A stored key that no longer verifies (e.g. the public key was rotated) is
    // ignored rather than trusted; the install falls back to its trial window.
    if ('payload' in parsed && parsed.payload.installId === installId) {
      plan = parsed.payload.plan
      customer = parsed.payload.customer
      expiresAt = parsed.payload.expiresAt
    }
  }

  const msLeft = expiresAt - effectiveNow
  const expired = msLeft <= 0
  const daysLeft = Math.max(0, Math.ceil(msLeft / DAY))

  return {
    state: expired ? 'expired' : plan === 'paid' ? 'active' : 'trial',
    plan,
    customer,
    installId,
    expiresAt: new Date(expiresAt).toISOString(),
    daysLeft,
    warning: expired || daysLeft <= WARN_DAYS,
    clockRolledBack,
  }
}

export function installLicence(key: string, employeeId: string): LicenceStatus {
  const parsed = parseLicence(key)
  if ('error' in parsed) throw conflict(parsed.error)

  const { installId } = licenceStatus()
  if (parsed.payload.installId !== installId) {
    throw conflict('That licence key is for a different installation. Check the install ID on this screen.')
  }
  if (parsed.payload.expiresAt <= Date.now()) {
    throw conflict('That licence key has already expired.')
  }

  db.update(s.settings).set({ licenceKey: key.trim() }).where(eq(s.settings.id, 'singleton')).run()
  audit(employeeId, 'licence.install', 'settings', 'singleton', {
    plan: parsed.payload.plan,
    customer: parsed.payload.customer,
    expiresAt: new Date(parsed.payload.expiresAt).toISOString(),
  })
  return licenceStatus()
}

/**
 * What an expired licence stops.
 *
 * Deliberately narrow — the spec says never hard-lock mid-service. Expiry stops
 * NEW orders, and NEW shifts once nothing is left to settle (`canOpenShift`).
 * Tables already seated can still add a round, be billed and settled — opening
 * a shift for it if needed — the shift can still be closed and reports read.
 */
export function assertLicensed(action: 'new order' | 'open shift'): void {
  const status = licenceStatus()
  if (status.state !== 'expired') return
  const what = status.plan === 'trial' ? 'The free trial has ended' : 'The licence has expired'
  throw licenceRequired(
    action === 'new order'
      ? `${what}, so a new order cannot be started. Open orders can still be billed and settled. ` +
        'Renew under Licence on the counter PC.'
      : `${what}, so a new shift cannot be started — there are no open orders left to settle. ` +
        'Renew under Licence on the counter PC.',
  )
}
