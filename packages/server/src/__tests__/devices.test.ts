import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

process.env.POS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'pos-devices-')), 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const D = await import('../services/devices.js')
const { createServer } = await import('../index.js')
const { eq } = await import('drizzle-orm')

const s = schema
const LAN = '192.168.1.50'
let admin = ''
let app: Awaited<ReturnType<typeof createServer>>

beforeAll(async () => {
  migrateDb()
  seed()
  admin = db.select().from(s.employees).where(eq(s.employees.name, 'Fatima')).get()!.id
  app = await createServer({ logger: false })
})
afterAll(async () => { await app.close() })
beforeEach(() => D._resetPairingState())

/** Pair a tablet through the real HTTP surface and return its token. */
async function pairTablet(name = 'Tablet 1') {
  const { code } = D.createPairingCode(admin)
  const res = await app.inject({ method: 'POST', url: '/api/devices/pair', remoteAddress: LAN, payload: { code, name } })
  expect(res.statusCode).toBe(200)
  return res.json() as { deviceId: string; token: string; name: string }
}

describe('pairing codes', () => {
  it('exchanges a code for a token, once', async () => {
    const { code } = D.createPairingCode(admin)
    const first = D.pairDevice({ code, name: 'Tablet A' }, LAN)
    expect(first.token.length).toBeGreaterThan(30)
    expect(() => D.pairDevice({ code }, LAN)).toThrow(/no pairing code is active/i)
  })

  it('stores only a hash of the token', () => {
    const { code } = D.createPairingCode(admin)
    const { deviceId, token } = D.pairDevice({ code }, LAN)
    const row = db.select().from(s.devices).where(eq(s.devices.id, deviceId)).get()!
    expect(row.pairToken).not.toBe(token)
    expect(row.pairToken).toMatch(/^[0-9a-f]{64}$/)
  })

  it('invalidates the previous code when a new one is issued', () => {
    const old = D.createPairingCode(admin).code
    D.createPairingCode(admin)
    expect(() => D.pairDevice({ code: old }, LAN)).toThrow(/wrong or has expired/i)
  })

  it('locks a caller out after repeated wrong codes', () => {
    D.createPairingCode(admin)
    for (let i = 0; i < 5; i++) expect(() => D.pairDevice({ code: '000000' }, '10.0.0.9')).toThrow()
    expect(() => D.pairDevice({ code: '000000' }, '10.0.0.9')).toThrow(/too many wrong codes/i)
  })
})

describe('access control', () => {
  it('rejects an unpaired device on the LAN', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bootstrap', remoteAddress: LAN })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('unpaired')
  })

  it('lets the health check through without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', remoteAddress: LAN })
    expect(res.statusCode).toBe(200)
  })

  it('lets a paired tablet take orders', async () => {
    const { token } = await pairTablet()
    const res = await app.inject({ method: 'GET', url: '/api/bootstrap', remoteAddress: LAN, headers: { 'x-device-token': token } })
    expect(res.statusCode).toBe(200)
  })

  it('never ships the licence key or install id to a tablet', async () => {
    const { token } = await pairTablet()
    const body = (await app.inject({ method: 'GET', url: '/api/bootstrap', remoteAddress: LAN, headers: { 'x-device-token': token } })).json()
    expect(body.settings.installId).toBeUndefined()
    expect(body.settings.licenceKey).toBeUndefined()
    expect(body.licence.state).toBeDefined()
  })

  it('keeps a tablet out of counter-only actions', async () => {
    const { token } = await pairTablet()
    const h = { 'x-device-token': token }
    for (const [method, url] of [
      ['POST', '/api/orders/x/settle'],
      ['POST', '/api/orders/x/void'],
      ['POST', '/api/orders/x/discount'],
      ['GET', '/api/masters/items'],
      ['GET', '/api/reports/summary'],
      ['POST', '/api/licence'],
      ['POST', '/api/devices/code'],
    ] as const) {
      const res = await app.inject({ method, url, remoteAddress: LAN, headers: h, payload: {} })
      expect(res.statusCode, `${method} ${url}`).toBe(403)
    }
  })

  it('lets the counter PC do everything without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/masters/items', remoteAddress: '127.0.0.1' })
    expect(res.statusCode).toBe(200)
  })

  it('scopes a token as a tablet even from loopback (adb reverse)', async () => {
    const { token } = await pairTablet()
    const res = await app.inject({ method: 'GET', url: '/api/masters/items', remoteAddress: '127.0.0.1', headers: { 'x-device-token': token } })
    expect(res.statusCode).toBe(403)
  })

  it('cannot be fooled by a forwarded-for header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/masters/items', remoteAddress: LAN, headers: { 'x-forwarded-for': '127.0.0.1' } })
    expect(res.statusCode).toBe(401)
  })
})

describe('revocation', () => {
  it('takes effect on the very next request', async () => {
    const { deviceId, token } = await pairTablet('Lost tablet')
    const h = { 'x-device-token': token }
    expect((await app.inject({ method: 'GET', url: '/api/devices/me', remoteAddress: LAN, headers: h })).statusCode).toBe(200)

    D.revokeDevice(deviceId, admin)
    const res = await app.inject({ method: 'GET', url: '/api/orders/open', remoteAddress: LAN, headers: h })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('unpaired')
  })

  it('lists devices without exposing token hashes', () => {
    const rows = D.listDevices()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => !('pairToken' in r))).toBe(true)
  })
})
