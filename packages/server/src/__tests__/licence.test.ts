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

describe('no automatic trial', () => {
  it('a fresh hub is unlicensed and creates a stable install id', () => {
    setSettings({ trialStartedAt: null, trialEndsAt: null, licenceKey: null })
    const st = L.licenceStatus()
    expect(st.state).toBe('unlicensed')
    expect(st.expiresAt).toBeNull()
    expect(st.installId).toMatch(/^[0-9a-f-]{36}$/)
    expect(L.licenceStatus().installId).toBe(st.installId) // stable
    // Asking for the status must not quietly start a trial.
    expect(db.select().from(s.settings).get()!.trialEndsAt).toBeNull()
  })

  it('blocks new orders and new shifts until a trial or key arrives', () => {
    expect(() => createOrder({ type: 'takeaway', createdBy: admin })).toThrow(/no licence or trial/i)
    expect(() => openShift({ counterId: counter, employeeId: admin, openingFloat: 0 })).toThrow(/no licence or trial/i)
  })
})

describe('superadmin trial', () => {
  it('grants a trial in minutes, hours or days, counted from now', () => {
    const t0 = Date.now()
    expect(L.grantTrial(10, 'minutes', t0).msLeft).toBe(10 * 60_000)
    expect(L.grantTrial(3, 'hours', t0).msLeft).toBe(3 * 3_600_000)
    const st = L.grantTrial(30, 'days', t0)
    expect(st.state).toBe('trial')
    expect(st.plan).toBe('trial')
    expect(st.daysLeft).toBe(30)
    const order = createOrder({ type: 'takeaway', createdBy: admin })!
    // An unsettled order would let an expired hub open a shift later in the file.
    db.delete(s.orders).where(eq(s.orders.id, order.id)).run()
  })

  it('a 5-minute trial runs out after 5 minutes', () => {
    const t0 = Date.now()
    L.grantTrial(5, 'minutes', t0)
    expect(L.licenceStatus(t0 + 4 * 60_000).state).toBe('trial')
    expect(L.licenceStatus(t0 + 5 * 60_000 + 1).state).toBe('expired')
  })

  it('0 ends the trial now — for testing expiry', () => {
    expect(L.grantTrial(0, 'minutes').state).toBe('expired')
  })

  it('rejects nonsense and over-long grants', () => {
    expect(() => L.grantTrial(-1, 'days')).toThrow(/whole number/i)
    expect(() => L.grantTrial(1.5, 'hours')).toThrow(/whole number/i)
    expect(() => L.grantTrial(1, 'weeks' as never)).toThrow(/minutes, hours or days/i)
    expect(() => L.grantTrial(400, 'days')).toThrow(/at most 366 days/i)
  })

  it('warns in the last week', () => {
    const st = L.grantTrial(5, 'days')
    expect(st.daysLeft).toBe(5)
    expect(st.warning).toBe(true)
  })

  it('audits each grant', () => {
    const rows = db.select().from(s.auditLog).all().filter((r) => r.action === 'superadmin.grant_trial')
    expect(rows.length).toBeGreaterThan(0)
    expect(JSON.parse(rows.at(-1)!.detailJson!)).toMatchObject({ value: 5, unit: 'days' })
  })
})

describe('expiry never hard-locks service', () => {
  it('blocks new orders and new shifts once expired', () => {
    setSettings({ trialEndsAt: new Date(Date.now() - DAY) })
    expect(() => createOrder({ type: 'takeaway', createdBy: admin })).toThrow(/trial has ended/i)
    expect(() => openShift({ counterId: counter, employeeId: admin, openingFloat: 0 })).toThrow(/new shift/i)
  })

  it('still opens a shift while an order is waiting to be settled, so the table can pay', () => {
    setSettings({ trialEndsAt: new Date(Date.now() + 25 * DAY) })
    const waiting = createOrder({ type: 'takeaway', createdBy: admin })!
    setSettings({ trialEndsAt: new Date(Date.now() - DAY) })
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
    setSettings({ trialEndsAt: new Date(Date.now() + 10 * DAY), licenceKey: null, clockHighWater: null })
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

describe('paid key and trial together', () => {
  it('whichever runs later wins, so a trial can bridge a lapsed key', () => {
    const { installId } = L.licenceStatus()
    L.installLicence(makeKey({ installId, expiresAt: Date.now() + 2 * DAY }), null)
    L.grantTrial(1, 'days')
    expect(L.licenceStatus().plan).toBe('paid') // key ends later
    L.grantTrial(10, 'days')
    const st = L.licenceStatus()
    expect(st.plan).toBe('trial')
    expect(st.daysLeft).toBe(10)
  })
})
