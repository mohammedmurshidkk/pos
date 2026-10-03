import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

process.env.POS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'pos-first-run-')), 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seedMinimal } = await import('../seed-minimal.js')
const { schema } = await import('@pos/shared')
const { createServer } = await import('../index.js')

const s = schema
const LOCAL = '127.0.0.1'
const LAN = '192.168.1.50'
let app: Awaited<ReturnType<typeof createServer>>
let token = ''

const call = (method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, remoteAddress: LOCAL, headers: { 'x-superadmin-token': token, ...headers }, ...(payload ? { payload } : {}) })

/**
 * The first installation, end to end: an empty database has no admin, no
 * superadmin password and no trial. The installer sets the password, adds the
 * first admin, grants a trial, and only then can the admin sign in and sell.
 */
beforeAll(async () => {
  migrateDb()
  seedMinimal()
  app = await createServer({ logger: false })
})
afterAll(async () => { await app.close() })

describe('a fresh install', () => {
  it('has no admin, no superadmin password and no trial', async () => {
    expect(db.select().from(s.employees).all()).toHaveLength(0)
    expect((await call('GET', '/api/superadmin/status')).json()).toEqual({ configured: false })
    expect((await call('GET', '/api/licence')).json().state).toBe('unlicensed')
  })

  it('does not ship any secret to a tablet in bootstrap', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bootstrap', remoteAddress: LOCAL })
    const settings = res.json().settings
    expect(settings).not.toHaveProperty('superadminHash')
    expect(settings).not.toHaveProperty('installId')
    expect(settings).not.toHaveProperty('trialEndsAt')
  })

  it('refuses first-time setup from a tablet', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/superadmin/setup', remoteAddress: LAN, payload: { password: 'from-the-wifi' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('sets the superadmin password once and opens a session', async () => {
    const res = await call('POST', '/api/superadmin/setup', { password: 'install-day-1' })
    expect(res.statusCode).toBe(200)
    token = res.json().token
    expect((await call('GET', '/api/superadmin/status')).json()).toEqual({ configured: true })

    const again = await call('POST', '/api/superadmin/setup', { password: 'take-it-over' })
    expect(again.statusCode).toBe(409)
  })

  it('adds the first admin with a starting PIN', async () => {
    const res = await call('POST', '/api/superadmin/admins', { name: 'Manager', pin: '1111' })
    expect(res.statusCode).toBe(200)
  })

  it('cannot take orders until the superadmin grants a trial', async () => {
    const manager = db.select().from(s.employees).get()!
    const blocked = await call('POST', '/api/orders', { type: 'takeaway', createdBy: manager.id })
    expect(blocked.statusCode).toBe(402)

    const trial = await call('POST', '/api/superadmin/trial', { value: 15, unit: 'minutes' })
    expect(trial.statusCode).toBe(200)
    expect(trial.json()).toMatchObject({ state: 'trial', plan: 'trial' })
    expect(trial.json().msLeft).toBeGreaterThan(14 * 60_000)

    const ok = await call('POST', '/api/orders', { type: 'takeaway', createdBy: manager.id })
    expect(ok.statusCode).toBe(200)
  })

  it('lets the admin sign in, then replace the starting PIN', async () => {
    const manager = db.select().from(s.employees).get()!
    expect((await call('POST', '/api/auth/login', { employeeId: manager.id, pin: '1111' })).statusCode).toBe(200)
    const changed = await call('POST', '/api/auth/change-pin', { employeeId: manager.id, currentPin: '1111', newPin: '2580' })
    expect(changed.statusCode).toBe(200)
    expect((await call('POST', '/api/auth/login', { employeeId: manager.id, pin: '1111' })).statusCode).toBe(403)
    expect((await call('POST', '/api/auth/login', { employeeId: manager.id, pin: '2580' })).statusCode).toBe(200)
  })

  it('needs a live superadmin session to grant a trial', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/superadmin/trial', remoteAddress: LOCAL, payload: { value: 30, unit: 'days' },
    })
    expect(res.statusCode).toBe(403)
  })
})
