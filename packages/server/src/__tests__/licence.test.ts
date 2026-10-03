import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

// A throwaway keypair: tests must never depend on the vendor's real signing key.
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
process.env.POS_LICENCE_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString()
process.env.POS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'pos-licence-')), 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const L = await import('../services/licence.js')
const { createOrder } = await import('../services/orders.js')
const { openShift } = await import('../services/shifts.js')
const { eq } = await import('drizzle-orm')

const s = schema
const DAY = 86_400_000
let admin = ''
let counter = ''

function makeKey(payload: Record<string, unknown>, key = privateKey) {
  const body = Buffer.from(JSON.stringify({ v: 1, plan: 'paid', customer: 'Al Manzil', issuedAt: Date.now(), ...payload })).toString('base64url')
  return `POS1.${body}.${sign(null, Buffer.from(body), key).toString('base64url')}`
}

const setSettings = (patch: Partial<typeof s.settings.$inferInsert>) =>
  db.update(s.settings).set(patch).where(eq(s.settings.id, 'singleton')).run()

beforeAll(() => {
  migrateDb()
  seed()
  admin = db.select().from(s.employees).where(eq(s.employees.name, 'Fatima')).get()!.id
  counter = db.select().from(s.counters).get()!.id
})

describe('trial', () => {
  it('starts a 30-day trial on first check and creates an install id', () => {
    const st = L.licenceStatus()
    expect(st.state).toBe('trial')
    expect(st.daysLeft).toBe(L.TRIAL_DAYS)
    expect(st.installId).toMatch(/^[0-9a-f-]{36}$/)
    expect(L.licenceStatus().installId).toBe(st.installId) // stable
  })

  it('warns in the last week', () => {
    setSettings({ trialStartedAt: new Date(Date.now() - 25 * DAY) })
    const st = L.licenceStatus()
    expect(st.daysLeft).toBe(5)
    expect(st.warning).toBe(true)
  })

  it('expires after 30 days', () => {
    setSettings({ trialStartedAt: new Date(Date.now() - 31 * DAY) })
    expect(L.licenceStatus().state).toBe('expired')
  })
})

describe('expiry never hard-locks service', () => {
  it('blocks new orders and new shifts once expired', () => {
    setSettings({ trialStartedAt: new Date(Date.now() - 31 * DAY) })
    expect(() => createOrder({ type: 'takeaway', createdBy: admin })).toThrow(/trial has ended/i)
    expect(() => openShift({ counterId: counter, employeeId: admin, openingFloat: 0 })).toThrow(/new shift/i)
  })

  it('still opens a shift while an order is waiting to be settled, so the table can pay', () => {
    setSettings({ trialStartedAt: new Date(Date.now() - 5 * DAY) })
    const waiting = createOrder({ type: 'takeaway', createdBy: admin })!
    setSettings({ trialStartedAt: new Date(Date.now() - 31 * DAY) })
    try {
      const shift = openShift({ counterId: counter, employeeId: admin, openingFloat: 0 })
      expect(shift.closedAt).toBeNull()
      expect(() => createOrder({ type: 'takeaway', createdBy: admin })).toThrow(/trial has ended/i)
    } finally {
      db.delete(s.shifts).run()
      db.delete(s.orders).where(eq(s.orders.id, waiting.id)).run()
    }
    expect(() => openShift({ counterId: counter, employeeId: admin, openingFloat: 0 }))
      .toThrow(/no open orders left to settle/i)
  })

  it('uses a 402 so the tablet queue can tell it apart from a permission error', () => {
    try {
      createOrder({ type: 'takeaway', createdBy: admin })
      expect.unreachable()
    } catch (e) {
      expect((e as { status: number }).status).toBe(402)
      expect((e as { code: string }).code).toBe('licence_expired')
    }
  })
})

describe('clock rollback', () => {
  it('cannot rewind expiry by setting the PC clock back', () => {
    setSettings({ trialStartedAt: new Date(Date.now() - 20 * DAY), licenceKey: null, clockHighWater: null })
    L.licenceStatus() // records now as the high-water mark
    // Pretend the clock has been wound back 15 days.
    const st = L.licenceStatus(Date.now() - 15 * DAY)
    expect(st.clockRolledBack).toBe(true)
    expect(st.daysLeft).toBe(10) // still counted from the real latest time
  })
})

describe('licence keys', () => {
  it('activates a paid licence for this install', () => {
    const { installId } = L.licenceStatus()
    const st = L.installLicence(makeKey({ installId, expiresAt: Date.now() + 365 * DAY }), admin)
    expect(st.state).toBe('active')
    expect(st.plan).toBe('paid')
    expect(st.customer).toBe('Al Manzil')
    expect(st.daysLeft).toBe(365)
  })

  it('lets orders through again once licensed', () => {
    expect(createOrder({ type: 'takeaway', createdBy: admin })).toBeTruthy()
  })

  it('rejects a key for another installation', () => {
    expect(() => L.installLicence(makeKey({ installId: 'someone-else', expiresAt: Date.now() + DAY }), admin))
      .toThrow(/different installation/i)
  })

  it('rejects a key signed by anyone but the vendor', () => {
    const { installId } = L.licenceStatus()
    const forger = generateKeyPairSync('ed25519').privateKey
    expect(() => L.installLicence(makeKey({ installId, expiresAt: Date.now() + DAY }, forger), admin))
      .toThrow(/not valid/i)
  })

  it('rejects a tampered payload even with a real signature attached', () => {
    const { installId } = L.licenceStatus()
    const real = makeKey({ installId, expiresAt: Date.now() + DAY })
    const [prefix, , sig] = real.split('.')
    const forged = Buffer.from(JSON.stringify({ v: 1, installId, plan: 'paid', customer: 'x', issuedAt: 0, expiresAt: Date.now() + 9999 * DAY })).toString('base64url')
    expect(() => L.installLicence(`${prefix}.${forged}.${sig}`, admin)).toThrow(/not valid/i)
  })

  it('rejects an already-expired key and garbage', () => {
    const { installId } = L.licenceStatus()
    expect(() => L.installLicence(makeKey({ installId, expiresAt: Date.now() - DAY }), admin)).toThrow(/already expired/i)
    expect(() => L.installLicence('hello', admin)).toThrow(/not a licence key/i)
  })

  it('records activation in the audit log without the key itself', () => {
    const rows = db.select().from(s.auditLog).all().filter((r) => r.action === 'licence.install')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => !(r.detailJson ?? '').includes('POS1.'))).toBe(true)
  })
})
