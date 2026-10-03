import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

process.env.POS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'pos-super-')), 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const S = await import('../services/superadmin.js')
const A = await import('../services/auth.js')
const D = await import('../services/devices.js')
const { createServer } = await import('../index.js')
const { eq } = await import('drizzle-orm')

const s = schema
const PASSWORD = 'superadmin1'
const LAN = '192.168.1.50'
let app: Awaited<ReturnType<typeof createServer>>
const admin = (name: string) => db.select().from(s.employees).where(eq(s.employees.name, name)).get()!

beforeAll(async () => {
  migrateDb()
  seed()
  app = await createServer({ logger: false })
})
afterAll(async () => { await app.close() })
beforeEach(() => { S._resetSuperadminState(); D._resetPairingState() })

describe('signing in', () => {
  it('accepts the password and hands back a session token', () => {
    const { token } = S.superadminLogin(PASSWORD, '127.0.0.1')
    expect(token.length).toBeGreaterThan(20)
    expect(() => S.requireSuperadmin(token)).not.toThrow()
  })

  it('rejects the wrong password and locks out after repeated tries', () => {
    for (let i = 0; i < 5; i++) expect(() => S.superadminLogin('nope', '10.0.0.7')).toThrow(/wrong password/i)
    expect(() => S.superadminLogin(PASSWORD, '10.0.0.7')).toThrow(/too many attempts/i)
  })

  it('never stores the password in the clear', () => {
    const row = db.select().from(s.settings).get()!
    expect(row.superadminHash).not.toContain(PASSWORD)
    expect(row.superadminHash!.startsWith('scrypt$')).toBe(true)
  })

  it('refuses an unknown or ended session', () => {
    expect(() => S.requireSuperadmin('made-up')).toThrow(/session has ended/i)
    expect(() => S.requireSuperadmin(undefined)).toThrow(/session has ended/i)
  })

  it('refuses first-time setup once a password exists', () => {
    expect(() => S.setupSuperadmin('another-password')).toThrow(/already set up/i)
  })

  it('ends the session on logout', () => {
    const { token } = S.superadminLogin(PASSWORD, '127.0.0.1')
    S.superadminLogout(token)
    expect(() => S.requireSuperadmin(token)).toThrow(/session has ended/i)
  })

  it('records logins and failures in the audit log', () => {
    const actions = db.select().from(s.auditLog).all().map((r) => r.action)
    expect(actions).toContain('superadmin.login')
    expect(actions).toContain('superadmin.failed')
  })
})

describe('managing this unit\'s admins', () => {
  it('lists admins without exposing PIN hashes', () => {
    const rows = S.listAdmins()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => !('pinHash' in r))).toBe(true)
    expect(rows.find((r) => r.name === 'Fatima')!.hasPin).toBe(true)
  })

  it('creates a new admin who can sign in straight away', () => {
    const created = S.createAdmin({ name: 'Nadia', pin: '2468' })
    expect(created.hasPin).toBe(true)
    expect(A.login(admin('Nadia').id, '2468').name).toBe('Nadia')
  })

  it('refuses a duplicate name and a bad PIN', () => {
    expect(() => S.createAdmin({ name: 'nadia', pin: '1111' })).toThrow(/already exists/i)
    expect(() => S.createAdmin({ name: 'Omar', pin: '12' })).toThrow(/4 digits/i)
  })

  it('resets a forgotten PIN — the reason this exists', () => {
    const fatima = admin('Fatima')
    expect(() => A.login(fatima.id, '9999')).toThrow(/wrong pin/i)
    S.resetAdminPin(fatima.id, '9999')
    expect(A.login(fatima.id, '9999').name).toBe('Fatima')
  })

  it('never writes a PIN into the audit log', () => {
    const rows = db.select().from(s.auditLog).all()
      .filter((r) => String(r.action).startsWith('superadmin.'))
    expect(rows.every((r) => !(r.detailJson ?? '').includes('9999'))).toBe(true)
  })

  it('disables and re-enables an admin', () => {
    const nadia = admin('Nadia')
    S.setAdminActive(nadia.id, false)
    expect(() => A.login(nadia.id, '2468')).toThrow(/not found/i)
    S.setAdminActive(nadia.id, true)
    expect(A.login(nadia.id, '2468').name).toBe('Nadia')
  })

  it('refuses to disable the last admin who can sign in', () => {
    for (const name of ['Nadia', 'Salim']) S.setAdminActive(admin(name).id, false)
    expect(() => S.setAdminActive(admin('Fatima').id, false)).toThrow(/last admin/i)
  })

  it('changes its own password, and the old one stops working', () => {
    S.setSuperadminPassword('another good one')
    expect(() => S.superadminLogin(PASSWORD, '127.0.0.1')).toThrow(/wrong password/i)
    expect(S.superadminLogin('another good one', '127.0.0.1').token).toBeTruthy()
    S.setSuperadminPassword(PASSWORD)
  })

  it('refuses a short password', () => {
    expect(() => S.setSuperadminPassword('short')).toThrow(/at least 8/i)
  })
})

describe('the door only exists on the counter PC', () => {
  it('lets the counter PC reach it', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/superadmin/login',
      remoteAddress: '127.0.0.1', payload: { password: PASSWORD },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().token).toBeTruthy()
  })

  it('is invisible to an unpaired device on the shop wifi', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/superadmin/login',
      remoteAddress: LAN, payload: { password: PASSWORD },
    })
    expect(res.statusCode).toBe(401)
  })

  it('refuses a paired tablet even with the right password', async () => {
    const { code } = D.createPairingCode(admin('Fatima').id)
    const paired = await app.inject({
      method: 'POST', url: '/api/devices/pair', remoteAddress: LAN, payload: { code, name: 'T' },
    })
    const token = paired.json().token as string

    for (const url of ['/api/superadmin/login', '/api/superadmin/admins']) {
      const res = await app.inject({
        method: 'POST', url, remoteAddress: LAN,
        headers: { 'x-device-token': token }, payload: { password: PASSWORD },
      })
      expect(res.statusCode, url).toBe(403)
    }
  })

  it('needs a live session token for admin management over HTTP', async () => {
    const noToken = await app.inject({ method: 'GET', url: '/api/superadmin/admins', remoteAddress: '127.0.0.1' })
    expect(noToken.statusCode).toBe(403)

    const { token } = (await app.inject({
      method: 'POST', url: '/api/superadmin/login', remoteAddress: '127.0.0.1', payload: { password: PASSWORD },
    })).json() as { token: string }

    const withToken = await app.inject({
      method: 'GET', url: '/api/superadmin/admins', remoteAddress: '127.0.0.1',
      headers: { 'x-superadmin-token': token },
    })
    expect(withToken.statusCode).toBe(200)
  })
})
