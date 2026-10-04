#!/usr/bin/env node
/**
 * Licence tooling — run by YOU (the vendor), never shipped to a shop.
 *
 *   node tools/licence.mjs keygen
 *       Creates an Ed25519 keypair in ~/.zentivo-pos/ (brand.json → vendorKeyFolder). Prints the public key to
 *       paste into packages/server/src/licence-public-key.ts. Refuses to overwrite.
 *
 *   node tools/licence.mjs sign --install <id> --customer "Al Manzil" --days 365 [--plan paid|trial]
 *       Prints a licence key for one installation. The install id is shown on the
 *       counter PC under Licence. --hours <n> or --minutes <n> instead of --days
 *       make short keys for testing expiry.
 *
 *   No terminal? Open tools/licence-generator.html — same keys, in the browser.
 *
 *   node tools/licence.mjs inspect <key>
 *       Decodes a key without verifying it — for support calls.
 *
 * BACK UP ~/.zentivo-pos/licence-private.pem (a key still in ~/.almanzil-pos/ is found there). Lose it and you cannot issue or
 * renew a licence for any installed shop without shipping a new app build.
 */
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const brand = JSON.parse(readFileSync(new URL('../brand/brand.json', import.meta.url), 'utf8'))

/** The key folder is named in brand.json; a key still in a folder from an earlier name is used where it is. */
function keyDir() {
  if (process.env.POS_LICENCE_DIR) return process.env.POS_LICENCE_DIR
  const current = path.join(os.homedir(), brand.vendorKeyFolder)
  if (existsSync(path.join(current, 'licence-private.pem'))) return current
  const legacy = brand.legacyVendorKeyFolders
    .map((f) => path.join(os.homedir(), f))
    .find((d) => existsSync(path.join(d, 'licence-private.pem')))
  return legacy ?? current
}

const DIR = keyDir()
const PRIVATE = path.join(DIR, 'licence-private.pem')
const PUBLIC = path.join(DIR, 'licence-public.pem')

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const die = (msg) => { console.error(msg); process.exit(1) }

const [, , command, positional] = process.argv

if (command === 'keygen') {
  if (existsSync(PRIVATE)) die(`${PRIVATE} already exists — refusing to overwrite a signing key.`)
  mkdirSync(DIR, { recursive: true, mode: 0o700 })
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  writeFileSync(PRIVATE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  writeFileSync(PUBLIC, publicKey.export({ type: 'spki', format: 'pem' }))
  chmodSync(PRIVATE, 0o600)
  console.log(`private key: ${PRIVATE}  (back this up, never commit it)`)
  console.log(`public key:  ${PUBLIC}\n`)
  console.log(readFileSync(PUBLIC, 'utf8'))
} else if (command === 'sign') {
  const installId = arg('install')
  const customer = arg('customer')
  const unit = ['days', 'hours', 'minutes'].find((u) => arg(u) !== undefined)
  const amount = Number(unit ? arg(unit) : NaN)
  const plan = arg('plan') ?? 'paid'
  if (!installId || !customer || !Number.isFinite(amount) || amount <= 0) {
    die('usage: sign --install <id> --customer "<name>" (--days|--hours|--minutes) <n> [--plan paid|trial]')
  }
  const durationMs = amount * { days: 86_400_000, hours: 3_600_000, minutes: 60_000 }[unit]
  if (!['paid', 'trial'].includes(plan)) die('--plan must be paid or trial')
  if (!existsSync(PRIVATE)) die(`no signing key at ${PRIVATE} — run keygen first`)

  const now = Date.now()
  const payload = {
    v: 1,
    installId,
    customer,
    plan,
    issuedAt: now,
    expiresAt: now + durationMs,
  }
  const body = b64url(JSON.stringify(payload))
  const signature = sign(null, Buffer.from(body), createPrivateKey(readFileSync(PRIVATE)))
  console.log(`POS1.${body}.${b64url(signature)}`)
  console.error(`\n${customer} · ${plan} · expires ${new Date(payload.expiresAt).toLocaleString()}`)
} else if (command === 'inspect') {
  const [prefix, body] = String(positional ?? '').split('.')
  if (prefix !== 'POS1' || !body) die('not a POS1 licence key')
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  console.log({ ...p, issuedAt: new Date(p.issuedAt).toISOString(), expiresAt: new Date(p.expiresAt).toISOString() })
} else {
  die('commands: keygen | sign | inspect   (see the header of tools/licence.mjs)')
}
