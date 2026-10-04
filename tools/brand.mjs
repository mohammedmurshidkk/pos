#!/usr/bin/env node
/**
 * Regenerates every icon the apps ship from the two source drawings in brand/.
 *
 *   node tools/brand.mjs        (or: pnpm brand)
 *
 * Rebranding = edit brand/brand.json, replace brand/icon.svg and brand/mark.svg,
 * run this, commit. The generated files are committed too, so CI (which builds
 * from git) never needs to run it. See brand/README.md.
 *
 *   brand/icon.svg  full app icon (tile + mark)  -> Windows .ico, favicon, Android legacy icon
 *   brand/mark.svg  white mark, transparent      -> Android adaptive + themed icon, splash, tray
 */
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const brandDir = path.join(root, 'brand')
const brand = JSON.parse(await readFile(path.join(brandDir, 'brand.json'), 'utf8'))
const iconSvg = await readFile(path.join(brandDir, 'icon.svg'), 'utf8')
const markSvg = await readFile(path.join(brandDir, 'mark.svg'), 'utf8')

const png = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

/** Android masks the adaptive foreground to as little as a 61% circle — shrink the mark into it. */
function inset(svg, scale) {
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  const offset = (1024 * (1 - scale)) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` +
    `<g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g></svg>`
}

/** A Windows .ico holding PNG-compressed images (supported since Vista; electron-builder accepts it). */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16
    header.writeUInt8(size >= 256 ? 0 : size, e)
    header.writeUInt8(size >= 256 ? 0 : size, e + 1)
    header.writeUInt8(0, e + 2)
    header.writeUInt8(0, e + 3)
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...images.map((i) => i.data)])
}

const outputs = []
async function out(rel, data) {
  const file = path.join(root, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, data)
  outputs.push(rel)
}

// Windows: installer, .exe, shortcuts, taskbar, tray.
await out('packages/desktop/resources/icon.ico',
  ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: png(iconSvg, size) }))))
await out('packages/desktop/resources/icon.png', png(iconSvg, 512))
await out('packages/desktop/resources/tray.png', png(iconSvg, 32))

// Web (cashier UI, also what Electron's window shows).
await mkdir(path.join(root, 'packages/admin/public'), { recursive: true })
await copyFile(path.join(brandDir, 'icon.svg'), path.join(root, 'packages/admin/public/favicon.svg'))
outputs.push('packages/admin/public/favicon.svg')
await out('packages/admin/public/favicon-32.png', png(iconSvg, 32))
await out('packages/admin/public/apple-touch-icon.png', png(iconSvg, 180))

// Android (waiter app). Wired up in packages/mobile/app.config.js.
await out('packages/mobile/assets/icon.png', png(iconSvg, 1024))
await out('packages/mobile/assets/adaptive-icon.png', png(inset(markSvg, 0.62), 1024))
await out('packages/mobile/assets/monochrome-icon.png', png(inset(markSvg, 0.62), 1024))
await out('packages/mobile/assets/splash-icon.png', png(markSvg, 1024))

console.log(`${brand.productName}: wrote ${outputs.length} files`)
for (const o of outputs) console.log(`  ${o}`)
