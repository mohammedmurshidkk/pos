import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions, notesBetween, parseChangelog, type ChangelogEntry } from '@pos/shared'
import { notFound } from '../errors.js'

/**
 * Release notes and the tablet app, as the hub serves them.
 *
 * The desktop shell (desktop/src/updates.ts) downloads the APK matching its own
 * version into POS_TABLET_UPDATE_DIR with a tablet.json beside it, and points
 * POS_CHANGELOG at the CHANGELOG.md packed into the app. Run on its own (dev,
 * tests) the hub reads the repo's CHANGELOG.md and has no APK to offer.
 */

interface TabletManifest { version: string; file: string; size: number }

const changelogPath = () =>
  process.env.POS_CHANGELOG ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'CHANGELOG.md')

/** Every version in the changelog shipped with this hub, newest first. */
export function changelog(): ChangelogEntry[] {
  try {
    return parseChangelog(readFileSync(changelogPath(), 'utf8'))
  } catch {
    return []
  }
}

export function appVersion(): string | null {
  return process.env.POS_APP_VERSION ?? null
}

function tabletManifest(): (TabletManifest & { path: string }) | null {
  const dir = process.env.POS_TABLET_UPDATE_DIR
  if (!dir) return null
  try {
    const m = JSON.parse(readFileSync(path.join(dir, 'tablet.json'), 'utf8')) as TabletManifest
    const file = path.join(dir, path.basename(m.file))
    if (!existsSync(file)) return null
    return { ...m, path: file, size: statSync(file).size }
  } catch {
    return null
  }
}

/**
 * What a tablet on `current` should know: the APK the hub holds, whether it is
 * newer, and the notes in between (every version it skipped).
 */
export function tabletUpdate(current: string | null) {
  const apk = tabletManifest()
  if (!apk) return { available: false as const, hubVersion: appVersion() }
  const available = !current || compareVersions(apk.version, current) > 0
  return {
    available,
    hubVersion: appVersion(),
    version: apk.version,
    size: apk.size,
    notes: available ? notesBetween(changelog(), current, apk.version) : [],
  }
}

/** For Settings → Updates on the counter. */
export function tabletApkStatus(): { version: string; size: number } | null {
  const apk = tabletManifest()
  return apk ? { version: apk.version, size: apk.size } : null
}

export function tabletApkPath(): string {
  const apk = tabletManifest()
  if (!apk) throw notFound('tablet app')
  return apk.path
}
