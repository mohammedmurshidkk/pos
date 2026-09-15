import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const base = mkdtempSync(path.join(tmpdir(), 'pos-ui-'))
const ui = path.join(base, 'ui')
mkdirSync(path.join(ui, 'assets'), { recursive: true })
writeFileSync(path.join(ui, 'index.html'), '<!doctype html><title>POS</title>')
writeFileSync(path.join(ui, 'assets', 'app.js'), 'console.log(1)')
writeFileSync(path.join(base, 'secret.txt'), 'outside the ui folder')

process.env.POS_UI_DIR = ui
process.env.POS_DB = path.join(base, 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { migrateDb } = await import('../db.js')
const { createServer } = await import('../index.js')
let app: Awaited<ReturnType<typeof createServer>>

beforeAll(async () => {
  migrateDb()
  app = await createServer({ logger: false })
})
afterAll(async () => { await app.close() })

const get = (url: string, remoteAddress = '127.0.0.1') => app.inject({ method: 'GET', url, remoteAddress })

describe('serving the cashier UI', () => {
  it('serves index.html to the counter PC', async () => {
    const res = await get('/')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.body).toContain('<title>POS</title>')
  })

  it('serves assets with the right type', async () => {
    const res = await get('/assets/app.js')
    expect(res.headers['content-type']).toMatch(/javascript/)
  })

  it('falls back to the app shell for client-side routes', async () => {
    expect((await get('/billing')).body).toContain('<title>POS</title>')
  })

  it('does not let a path escape the UI folder', async () => {
    const res = await get('/..%2fsecret.txt')
    expect(res.body).not.toContain('outside the ui folder')
  })

  it('404s an unknown API path instead of returning HTML', async () => {
    const res = await get('/api/definitely-not-a-route')
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toMatch(/json/)
  })

  it('is not reachable from the shop wifi', async () => {
    expect((await get('/', '192.168.1.50')).statusCode).toBe(401)
  })
})
