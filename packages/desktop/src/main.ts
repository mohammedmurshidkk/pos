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

/** Startup progress goes to stdout so a support call can ask for the log. */
const log = (...args: unknown[]) => { console.log('[pos]', ...args) }

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
  createWindow()
  createTray()

  try {
    // Imported lazily on purpose: the server opens the SQLite file at module
    // load, so POS_DB must already be set. esbuild inlines it into this bundle.
    const { startServer } = await import('@pos/server')
    await startServer({ port: PORT, pretty: false })
    log('hub listening on', PORT)
    // Not loadFile: from file:// the UI's relative /api calls never reach the hub.
    await window?.loadURL(`http://127.0.0.1:${PORT}/`)
    log('ui loaded')
  } catch (err) {
    log('startup failed', err)
    showStartupFailure(err)
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
    {
      label: 'Open data folder',
      click: () => { void shell.openPath(app.getPath('userData')) },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('click', () => { window?.show(); window?.focus() })
}

/** A blank window tells the owner nothing. Say what failed and where to look. */
function showStartupFailure(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  dialog.showErrorBox(
    'Al Manzil POS could not start',
    `${message}\n\nData folder:\n${app.getPath('userData')}\n\n` +
    'If this keeps happening, send this message to support.',
  )
  quitting = true
  app.quit()
}

app.on('before-quit', () => { quitting = true })
// The hub must keep serving tablets with no window open, so do NOT quit here.
app.on('window-all-closed', () => {})
