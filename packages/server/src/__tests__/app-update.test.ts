import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmp = mkdtempSync(path.join(tmpdir(), 'pos-app-update-'))
process.env.POS_DB = path.join(tmp, 'test.db')
process.env.POS_PRINT_DISABLED = '1'
process.env.POS_APP_VERSION = '1.2.0'
process.env.POS_CHANGELOG = path.join(tmp, 'CHANGELOG.md')
process.env.POS_TABLET_UPDATE_DIR = path.join(tmp, 'tablet')

writeFileSync(process.env.POS_CHANGELOG, `# Changelog

## [Unreleased]

## [1.2.0] - 2026-10-20
### Added
- Tablets update from the counter

## [1.1.0] - 2026-10-18
### Fixed
- KOT number

## [1.0.0] - 2026-10-08
- First release
`)

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const D = await import('../services/devices.js')
const { createServer } = await import('../index.js')
const { eq } = await import('drizzle-orm')

const LAN = '192.168.1.50'
let app: Awaited<ReturnType<typeof createServer>>
let token = ''

beforeAll(async () => {
  migrateDb()
  seed()
  const admin = db.select().from(schema.employees).where(eq(schema.employees.name, 'Fatima')).get()!.id
  app = await createServer({ logger: false })
  const { code } = D.createPairingCode(admin)
  token = D.pairDevice({ code, name: 'Tablet 1' }, LAN).token
})
afterAll(async () => { await app.close() })

const asTablet = (url: string) =>
  app.inject({ method: 'GET', url, remoteAddress: LAN, headers: { 'x-device-token': token } })

describe('tablet app update', () => {
  it('offers nothing while the counter has not downloaded the APK', async () => {
    const res = await asTablet('/api/app-update?version=1.0.0')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ available: false, hubVersion: '1.2.0' })
    expect((await asTablet('/api/app-update/apk')).statusCode).toBe(404)
  })

  it('offers the APK with the notes of every version the tablet skipped', async () => {
    const dir = process.env.POS_TABLET_UPDATE_DIR!
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'ZentivoPOS-Waiter-1.2.0.apk'), 'PK-fake-apk')
    writeFileSync(path.join(dir, 'tablet.json'), JSON.stringify({ version: '1.2.0', file: 'ZentivoPOS-Waiter-1.2.0.apk', size: 0 }))

    const body = (await asTablet('/api/app-update?version=1.0.0')).json()
    expect(body).toMatchObject({ available: true, version: '1.2.0', size: 11 })
    expect(body.notes.map((n: { version: string }) => n.version)).toEqual(['1.2.0', '1.1.0'])

    const apk = await asTablet('/api/app-update/apk')
    expect(apk.statusCode).toBe(200)
    expect(apk.headers['content-type']).toBe('application/vnd.android.package-archive')
    expect(apk.body).toBe('PK-fake-apk')
  })

  it('says a tablet on the same version is up to date', async () => {
    expect((await asTablet('/api/app-update?version=1.2.0')).json()).toMatchObject({ available: false, notes: [] })
  })

  it('needs a paired tablet', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/app-update/apk', remoteAddress: LAN })
    expect(res.statusCode).toBe(401)
  })
})

describe('changelog for the counter', () => {
  it('lists every version and the APK held for tablets', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/changelog' })).json()
    expect(body.version).toBe('1.2.0')
    expect(body.entries.map((e: { version: string }) => e.version)).toEqual(['Unreleased', '1.2.0', '1.1.0', '1.0.0'])
    expect(body.tabletApk).toEqual({ version: '1.2.0', size: 11 })
  })

  it('is not open to tablets', async () => {
    expect((await asTablet('/api/changelog')).statusCode).toBe(403)
  })
})
