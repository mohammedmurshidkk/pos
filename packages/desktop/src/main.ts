import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, Menu, Tray, app, dialog, nativeImage, shell } from 'electron'

/**
 * The hub, as one double-click application.
 *
 * The restaurant owner is not a developer: there is no terminal, no "open
 * localhost:4000", no separate service to start. One icon, one window, a tray
 * icon so closing the window does not stop the till.
 */

const PORT = Number(process.env.POS_PORT ?? 4000)

let window: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

/**
 * Two copies of the hub would fight over the database and the invoice counter,
 * so the second launch just focuses the first.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
  })
  void main()
}

const URL_ = `http://127.0.0.1:${PORT}/`

/**
 * Startup progress goes to stdout AND to <data folder>/logs/main.log. A packaged
 * Windows app has no console, so without the file a failure on a shop PC (or a
 * test VM) leaves nothing to read but a generic Chromium error code.
 */
const logFile = path.join(app.getPath('userData'), 'logs', 'main.log')
try {
  mkdirSync(path.dirname(logFile), { recursive: true })
  // Start fresh once it passes 1 MB — enough history for one support call.
  if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > 1_000_000) writeFileSync(logFile, '')
} catch { /* logging must never stop the till */ }

const log = (...args: unknown[]) => {
  console.log('[pos]', ...args)
  const text = args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  try { appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`) } catch { /* see above */ }
}

// Chromium helper processes (network, GPU, renderer) crashing shows up in the
// window only as ERR_FAILED. Record which one died and why.
app.on('child-process-gone', (_e, d) => {
  log('child process gone', { type: d.type, reason: d.reason, exitCode: d.exitCode, name: d.name ?? d.serviceName })
})
app.on('render-process-gone', (_e, _wc, d) => { log('renderer gone', { reason: d.reason, exitCode: d.exitCode }) })

async function main() {
  await app.whenReady()
  log('electron ready')

  // Everything the business owns lives under userData — never beside the .exe,
  // which on Windows is a read-only Program Files directory.
  const dataDir = app.getPath('userData')
  process.env.POS_DB = path.join(dataDir, 'pos.db')
  process.env.POS_BACKUP_DIR = path.join(dataDir, 'backups')
  // Migrations ship inside the app, next to the bundled server.
  process.env.POS_MIGRATIONS = path.join(__dirname, 'drizzle')
  // The hub serves the UI, so it reaches /api over loopback — see index.ts.
  process.env.POS_UI_DIR = path.join(__dirname, 'ui')

  log('data folder', dataDir)
  log('app', { version: app.getVersion(), platform: process.platform, arch: process.arch,
    // x64 build running through emulation on ARM Windows (or Rosetta).
    emulated: app.runningUnderARM64Translation, electron: process.versions.electron })
  createWindow()
  createTray()

  try {
    // Imported lazily on purpose: the server opens the SQLite file at module
    // load, so POS_DB must already be set. esbuild inlines it into this bundle.
    const { startServer } = await import('@pos/server')
    await startServer({ port: PORT, pretty: false })
    log('hub listening on', PORT)
  } catch (err) {
    log('startup failed', err)
    showStartupFailure(err)
    return
  }

  // The hub is up from here on, and tablets can use it whatever the window does.
  // So a window that cannot show the UI must not take the hub down with it.
  try {
    await loadUi()
    log('ui loaded')
  } catch (err) {
    log('window could not load the UI', err)
    showUiFallback(err)
  }
}

/** Not loadFile: from file:// the UI's relative /api calls never reach the hub. */
async function loadUi(attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      await window?.loadURL(URL_)
      return
    } catch (err) {
      log(`load attempt ${i} failed`, err)
      if (i >= attempts) throw err
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#f1f5f9',
    title: 'Al Manzil POS',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  window.webContents.on('did-fail-load', (_e, code, description, url) => {
    log('did-fail-load', { code, description, url })
  })

  // Closing the window must not stop the till — a waiter's tablet is still
  // pointed at this machine. Only the tray menu really quits.
  window.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    window?.hide()
  })

  // Anything that is not the app opens in the real browser, not in our window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function createTray() {
  try {
    buildTray()
  } catch (err) {
    // A missing tray icon must never stop the till from starting.
    log('tray unavailable', err)
  }
}

function buildTray() {
  // A 1x1 transparent PNG: platforms reject a genuinely empty image, and the
  // installer supplies the real icon.
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  )
  tray = new Tray(icon)
  tray.setToolTip('Al Manzil POS')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Hub running on port ${PORT}`, enabled: false },
    { type: 'separator' },
    { label: 'Open', click: () => { window?.show(); window?.focus() } },
    { label: 'Open in web browser', click: () => { void shell.openExternal(URL_) } },
    {
      label: 'Open data folder',
      click: () => { void shell.openPath(app.getPath('userData')) },
    },
    { label: 'Open log', click: () => { void shell.openPath(logFile) } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('click', () => { window?.show(); window?.focus() })
}

/**
 * The hub is running but this window cannot show it (seen on Windows ARM running
 * the x64 build under emulation). Keep the hub up and use the real browser —
 * the UI is the same page either way.
 */
function showUiFallback(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  window?.hide()
  void shell.openExternal(URL_)
  void dialog.showMessageBox({
    type: 'warning',
    title: 'Al Manzil POS',
    message: 'The POS is running, but its window could not open the screen.',
    detail: `It has been opened in your web browser instead: ${URL_}\n\n` +
      `Tablets can connect as normal. Use the tray icon → "Open in web browser" to get back to it.\n\n` +
      `${message}\n\nLog: ${logFile}\nSend the log to support if this keeps happening.`,
  })
}

/** A blank window tells the owner nothing. Say what failed and where to look. */
function showStartupFailure(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  dialog.showErrorBox(
    'Al Manzil POS could not start',
    `${message}\n\nData folder:\n${app.getPath('userData')}\nLog: ${logFile}\n\n` +
    'If this keeps happening, send this message to support.',
  )
  quitting = true
  app.quit()
}

app.on('before-quit', () => { quitting = true })
// The hub must keep serving tablets with no window open, so do NOT quit here.
app.on('window-all-closed', () => {})
