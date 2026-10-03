import { generateKeyPairSync, type webcrypto } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * tools/licence-generator.html signs keys in the browser. Its signing code is
 * run here against the hub's own verifier, so the page and the hub cannot
 * drift apart (payload fields, base64url, what exactly gets signed).
 */
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
process.env.POS_LICENCE_PUBLIC_KEY = publicPem
process.env.POS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'pos-licgen-')), 'test.db')

const { parseLicence } = await import('../services/licence.js')

const here = path.dirname(fileURLToPath(import.meta.url))
const html = readFileSync(path.resolve(here, '../../../../tools/licence-generator.html'), 'utf8')
const core = /<script id="licence-core">([\s\S]*?)<\/script>/.exec(html)![1]!

type CryptoKey = webcrypto.CryptoKey

interface Core {
  importPrivatePem(pem: string): Promise<{ privateKey: CryptoKey; publicPem: string }>
  generateKeypair(): Promise<{ privatePem: string; publicPem: string }>
  makeLicence(input: Record<string, unknown>): Promise<{ key: string; payload: Record<string, unknown> }>
  inspectLicence(key: string, publicKey?: CryptoKey): Promise<{ payload: Record<string, unknown>; valid: boolean | null }>
}
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const page = new Function(`${core}; return { importPrivatePem, generateKeypair, makeLicence, inspectLicence }`)() as Core

describe('licence generator page', () => {
  it('reads the vendor PEM and shows the matching public key', async () => {
    const { publicPem: derived } = await page.importPrivatePem(privatePem)
    expect(derived.trim()).toBe(publicPem.trim())
  })

  it('makes a 10-minute key the hub accepts', async () => {
    const { privateKey: signer } = await page.importPrivatePem(privatePem)
    const now = Date.now()
    const { key } = await page.makeLicence({
      privateKey: signer, installId: 'abc-123', customer: 'Test', plan: 'paid', value: '10', unit: 'minutes', now,
    })
    const parsed = parseLicence(key)
    expect('payload' in parsed && parsed.payload).toMatchObject({
      v: 1, installId: 'abc-123', customer: 'Test', plan: 'paid', issuedAt: now, expiresAt: now + 10 * 60_000,
    })
  })

  it('supports hours and days, and refuses bad input', async () => {
    const { privateKey: signer } = await page.importPrivatePem(privatePem)
    const base = { privateKey: signer, installId: 'abc', customer: 'X', plan: 'trial', now: 0 }
    expect((await page.makeLicence({ ...base, value: 2, unit: 'hours' })).payload.expiresAt).toBe(2 * 3_600_000)
    expect((await page.makeLicence({ ...base, value: 30, unit: 'days' })).payload.expiresAt).toBe(30 * 86_400_000)
    await expect(page.makeLicence({ ...base, value: 0, unit: 'days' })).rejects.toThrow(/greater than 0/)
    await expect(page.makeLicence({ ...base, value: 1, installId: ' ', unit: 'days' })).rejects.toThrow(/install ID/)
    await expect(page.importPrivatePem(publicPem)).rejects.toThrow(/not a private key/)
  })

  it('a freshly created keypair signs keys its own public key verifies', async () => {
    const pair = await page.generateKeypair()
    const { privateKey: signer, publicPem: derived } = await page.importPrivatePem(pair.privatePem)
    expect(derived.trim()).toBe(pair.publicPem.trim())
    const { key } = await page.makeLicence({ privateKey: signer, installId: 'i', customer: 'c', plan: 'paid', value: 1, unit: 'days' })
    // Signed by a different key than the hub trusts in this test.
    expect(parseLicence(key)).toEqual({ error: 'That licence key is not valid.' })
  })

  it('decodes a key and checks its signature', async () => {
    const { privateKey: signer } = await page.importPrivatePem(privatePem)
    const { key } = await page.makeLicence({ privateKey: signer, installId: 'i', customer: 'c', plan: 'paid', value: 1, unit: 'days' })
    const spki = publicKey.export({ type: 'spki', format: 'der' })
    const verifier = await crypto.subtle.importKey('spki', spki, { name: 'Ed25519' }, false, ['verify'])
    expect((await page.inspectLicence(key, verifier)).valid).toBe(true)
    expect((await page.inspectLicence(key)).valid).toBeNull()
  })
})
