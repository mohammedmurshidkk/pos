import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { BrowserWindow, app, ipcMain, net } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { notesBetween, parseChangelog, type ChangelogEntry } from '@pos/shared'
import brand from '../../../brand/brand.json'

/**
 * Updates, so nobody has to send the installer and the APK over WhatsApp.
 *
 * The feed is the GitHub release that CI makes for every v* tag
 * (.github/workflows/build-windows.yml, build-apk.yml):
 *
 *   counter  electron-updater reads latest.yml from the newest release, downloads
 *            the installer in the background, and installs it when the cashier
 *            taps "Restart and update". Never by itself: restarting the hub drops
 *            the tablets for a minute, so it waits for a person.
 *   tablets  have no internet of their own on many shop wifis, so the counter
 *            fetches the APK of ITS OWN version from the same release and serves
 *            it at /api/app-update/apk. Tablets therefore follow the counter and
 *            never run ahead of the hub they talk to.
 *   notes    CHANGELOG.md at the release's tag, cut to the versions the shop has
 *            not seen yet.
 */

export type UpdateState =
  | { status: 'unsupported' }
  | { status: 'idle' | 'checking' | 'latest'; checkedAt: string | null }
  | { status: 'available' | 'downloading'; version: string; percent: number; notes: ChangelogEntry[] }
  | { status: 'ready'; version: string; notes: ChangelogEntry[] }
  | { status: 'error'; message: string; checkedAt: string | null }

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
/** Cheap once the APK is here; until then CI may still be attaching it to the release. */
const TABLET_APK_EVERY_MS = 30 * 60 * 1000
const FIRST_CHECK_AFTER_MS = 60 * 1000
const { githubOwner, githubRepo, tabletApkFileName } = brand.updates
const RELEASE_DOWNLOAD = `https://github.com/${githubOwner}/${githubRepo}/releases/download`
const RAW = `https://raw.githubusercontent.com/${githubOwner}/${githubRepo}`

let state: UpdateState = { status: 'idle', checkedAt: null }
let checkedAt: string | null = null
let log: (...args: unknown[]) => void = console.log

function setState(next: UpdateState) {
  state = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:changed', state)
}

/** The folder the hub serves the tablet APK from; see server/src/services/app-update.ts. */
export const tabletUpdateDir = () => path.join(app.getPath('userData'), 'updates', 'tablet')

export function startUpdates(opts: { log: (...args: unknown[]) => void; beforeInstall: () => void }) {
  log = opts.log

  ipcMain.handle('update:get', () => state)
  ipcMain.handle('update:check', () => check())
  ipcMain.handle('update:install', () => {
    if (state.status !== 'ready') return false
    log('update: restarting to install', state.version)
    opts.beforeInstall()
    // Silent: the cashier already chose to update; the NSIS pages would only
    // ask the same questions as the first install. Then start the till again.
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
    return true
  })

  // `pnpm start` on a Mac has no installer to update.
  if (!app.isPackaged || process.platform !== 'win32') {
    state = { status: 'unsupported' }
    void fetchTabletApk()
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = { info: (m: unknown) => log('updater', m), warn: (m: unknown) => log('updater warn', m),
    error: (m: unknown) => log('updater error', m), debug: () => {} }

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', checkedAt }))
  autoUpdater.on('update-not-available', () => {
    checkedAt = new Date().toISOString()
    setState({ status: 'latest', checkedAt })
  })
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    checkedAt = new Date().toISOString()
    setState({ status: 'available', version: info.version, percent: 0, notes: [] })
    void notesFor(info.version).then((notes) => {
      if ((state.status === 'available' || state.status === 'downloading' || state.status === 'ready') &&
        state.version === info.version) setState({ ...state, notes })
    })
  })
  autoUpdater.on('download-progress', (p: { percent: number }) => {
    if (state.status === 'available' || state.status === 'downloading') {
      setState({ ...state, status: 'downloading', percent: Math.round(p.percent) })
    }
  })
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    const notes = 'notes' in state ? state.notes : []
    log('update: downloaded', info.version)
    setState({ status: 'ready', version: info.version, notes })
  })
  autoUpdater.on('error', (err: Error) => {
    // No internet is normal for a till; keep the last good state visible in the log only.
    log('update: check failed', err.message)
    setState({ status: 'error', message: friendly(err), checkedAt })
  })

  setTimeout(() => { void check() }, FIRST_CHECK_AFTER_MS)
  setInterval(() => { void check() }, CHECK_EVERY_MS)
  void fetchTabletApk()
  setInterval(() => { void fetchTabletApk() }, TABLET_APK_EVERY_MS)
}

async function check(): Promise<UpdateState> {
  if (state.status === 'unsupported') return state
  // A download in progress or waiting to install is not interrupted by a re-check.
  if (state.status === 'downloading' || state.status === 'ready') return state
  try {
    await autoUpdater.checkForUpdates()
  } catch { /* reported through the 'error' event */ }
  return state
}

function friendly(err: Error) {
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|net::/.test(err.message)
    ? 'No internet connection on this PC.'
    : 'Could not check for updates.'
}

/** What is new between the running version and `version`, from CHANGELOG.md at that tag. */
async function notesFor(version: string): Promise<ChangelogEntry[]> {
  try {
    const res = await net.fetch(`${RAW}/v${version}/CHANGELOG.md`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return notesBetween(parseChangelog(await res.text()), app.getVersion(), version)
  } catch (err) {
    log('update: release notes unavailable', err instanceof Error ? err.message : err)
    return []
  }
}

/**
 * Keep the APK that matches this counter's version in tabletUpdateDir(), with
 * tablet.json beside it. Tries again later when the PC is offline or CI has not
 * attached the APK to the release yet.
 */
async function fetchTabletApk() {
  const version = app.getVersion()
  const dir = tabletUpdateDir()
  const file = `${tabletApkFileName}-${version}.apk`
  const manifestPath = path.join(dir, 'tablet.json')
  try {
    if (existsSync(manifestPath)) {
      const current = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string }
      if (current.version === version && existsSync(path.join(dir, file))) return
    }
    const res = await net.fetch(`${RELEASE_DOWNLOAD}/v${version}/${file}`)
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

    mkdirSync(dir, { recursive: true })
    const partial = path.join(dir, `${file}.part`)
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(partial))
    renameSync(partial, path.join(dir, file))
    const size = statSync(path.join(dir, file)).size
    writeFileSync(manifestPath, JSON.stringify({ version, file, size, downloadedAt: new Date().toISOString() }, null, 2))
    log('update: tablet app ready for tablets', version, size)

    // Older APKs are never served again.
    for (const old of readdirSync(dir)) {
      if (old.endsWith('.apk') && old !== file) rmSync(path.join(dir, old), { force: true })
    }
  } catch (err) {
    log('update: tablet app not downloaded', version, err instanceof Error ? err.message : err)
  }
}
