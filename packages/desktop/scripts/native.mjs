import { execFileSync } from 'node:child_process'
import { copyFile, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Put the right better_sqlite3.node in every place pnpm keeps one.
 *
 * pnpm's hoisted layout has two copies — node_modules/better-sqlite3 and the
 * virtual store under node_modules/.pnpm — and electron-builder resolves the
 * store one. Patching only the hoisted copy silently produced a Windows
 * installer containing a macOS binary, which fails at launch on the client's PC
 * with a NODE_MODULE_VERSION error.
 *
 * Electron and plain Node have different ABIs (130 vs 115 here), so a binary
 * built for one fails to load in the other. Tests and `pnpm dev` run under
 * Node; the packaged app runs under Electron.
 *
 *   node scripts/native.mjs win32     → Windows x64, Electron ABI (for packaging)
 *   node scripts/native.mjs electron  → this machine, Electron ABI
 *   node scripts/native.mjs node      → this machine, Node ABI (tests, dev)
 */
const ELECTRON = '33.4.11'
const target = process.argv[2] ?? 'node'
if (!['win32', 'electron', 'node'].includes(target)) {
  throw new Error(`unknown target "${target}" — use win32, electron or node`)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.join(here, '../../..')
const modules = path.join(workspace, 'node_modules')
const canonical = path.join(modules, 'better-sqlite3')

const args = ['--tag-prefix=v']
if (target === 'node') {
  args.push('--runtime=node', `--target=${process.versions.node}`)
} else {
  args.push('--runtime=electron', `--target=${ELECTRON}`)
  if (target === 'win32') args.push('--arch=x64', '--platform=win32')
}

// Run prebuild-install's script with this Node directly, not through `pnpm exec`:
// on Windows pnpm is `pnpm.cmd`, which execFileSync refuses to spawn without a
// shell (Node ≥ 20.12, CVE-2024-27980) — the CI Windows build failed on exactly that.
const prebuild = createRequire(path.join(canonical, 'package.json')).resolve('prebuild-install/bin.js')
execFileSync(process.execPath, [prebuild, ...args], { cwd: canonical, stdio: 'inherit' })

const source = path.join(canonical, 'build/Release/better_sqlite3.node')

/** Every copy pnpm keeps, so whichever one the packager picks is correct. */
async function findCopies(dir, depth = 0) {
  if (depth > 4) return []
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'better-sqlite3') {
      const candidate = path.join(dir, entry.name, 'build/Release/better_sqlite3.node')
      if (await stat(candidate).then(() => true, () => false)) out.push(candidate)
    } else if (entry.name === '.pnpm' || entry.name.startsWith('better-sqlite3@')
               || entry.name === 'node_modules') {
      out.push(...await findCopies(path.join(dir, entry.name), depth + 1))
    }
  }
  return out
}

let patched = 0
for (const copy of await findCopies(modules)) {
  if (path.resolve(copy) === path.resolve(source)) continue
  await copyFile(source, copy)
  patched += 1
  console.log(`patched ${path.relative(workspace, copy)}`)
}
console.log(`native: ${target} ready (${patched + 1} cop${patched ? 'ies' : 'y'})`)
