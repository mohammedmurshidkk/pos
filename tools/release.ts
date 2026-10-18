/**
 * Ties CHANGELOG.md to the app version.
 *
 *   pnpm release 1.2.0        [Unreleased] becomes "## [1.2.0] - <today>" and
 *                             packages/desktop/package.json gets version 1.2.0
 *                             (the tablet app reads the same number).
 *   pnpm release:notes 1.2.0  prints that version's notes. CI uses it for the
 *                             GitHub release body, and fails the build when the
 *                             tag, the app version and the changelog disagree.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions, entryToMarkdown, parseChangelog, parseVersion } from '../packages/shared/src/changelog.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const changelogPath = path.join(root, 'CHANGELOG.md')
const desktopPkgPath = path.join(root, 'packages/desktop/package.json')

const [command, rawVersion] = process.argv.slice(2)
const version = rawVersion?.replace(/^v/, '')

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

if (!version || !parseVersion(version)) fail('Give a version like 1.2.0')

const changelog = readFileSync(changelogPath, 'utf8')
const desktopPkg = readFileSync(desktopPkgPath, 'utf8')
const appVersion = (JSON.parse(desktopPkg) as { version: string }).version
const entries = parseChangelog(changelog)

if (command === 'bump') {
  if (compareVersions(version, appVersion) <= 0) fail(`${version} must be higher than the current ${appVersion}`)
  if (entries.some((e) => e.version === version)) fail(`CHANGELOG.md already has [${version}]`)
  const unreleased = entries.find((e) => e.version === 'Unreleased')
  if (!unreleased?.sections.some((s) => s.items.length)) {
    fail('Nothing under [Unreleased] in CHANGELOG.md — write what changed first')
  }

  const today = new Date().toISOString().slice(0, 10)
  const nextChangelog = changelog.replace(/^## \[Unreleased\][^\n]*\n/m, (h) => `${h}\n## [${version}] - ${today}\n`)
  const nextPkg = desktopPkg.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`)
  writeFileSync(changelogPath, nextChangelog)
  writeFileSync(desktopPkgPath, nextPkg)

  console.log(`✓ CHANGELOG.md: [Unreleased] is now [${version}] - ${today}`)
  console.log(`✓ packages/desktop/package.json: ${appVersion} → ${version}`)
  console.log('\nNext:')
  console.log('  pnpm -r test && pnpm -r typecheck')
  console.log(`  git add -A && git commit -m "Release ${version}" && git push origin main`)
  console.log(`  git tag v${version} && git push origin v${version}`)
} else if (command === 'notes') {
  if (appVersion !== version) fail(`Tag says ${version} but packages/desktop/package.json says ${appVersion}`)
  const entry = entries.find((e) => e.version === version)
  if (!entry) fail(`CHANGELOG.md has no [${version}] section — run "pnpm release ${version}" before tagging`)
  process.stdout.write(`${entryToMarkdown(entry)}\n`)
} else {
  fail('Usage: tsx tools/release.ts bump|notes <version>')
}
