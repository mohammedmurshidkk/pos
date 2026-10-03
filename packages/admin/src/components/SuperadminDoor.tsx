import { useEffect, useState } from 'react'
import { ApiError, setSuperadminToken, superadmin } from '../api/client'
import { Superadmin } from '../screens/Superadmin'
import { Banner, Button, Field, Modal, inputStyle } from './ui'

/**
 * The hidden way in to Superadmin: Ctrl + Alt + Shift + A.
 *
 * Mounted above the router on purpose. The situation it exists for is "nobody
 * can sign in", so it has to work while the sign-in screen is showing — a route
 * or a nav item would be unreachable exactly when it is needed, and visible the
 * rest of the time.
 *
 * There is no label anywhere. The shortcut is in CLAUDE.md and the handover
 * notes, not on the screen.
 */
/**
 * `code`, not `key`: on macOS holding Option rewrites the character — Option+A
 * arrives as `key: "å"` — so matching on `key` silently never fires there.
 * `code` is the physical key and is also immune to non-QWERTY layouts.
 *
 *   Windows/Linux   Ctrl + Alt + Shift + A
 *   macOS           Control + Option + Shift + A   (⌃⌥⇧A)
 */
const SHORTCUT = { code: 'KeyA', ctrl: true, alt: true, shift: true }

export function SuperadminDoor() {
  const [asking, setAsking] = useState(false)
  const [open, setOpen] = useState(false)
  /** null until the hub answers; false on a fresh install with no password yet. */
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A fresh install has no superadmin password, so the door is not hidden on
  // first run: setup takes over the screen until the password is chosen. Keeps
  // asking until the hub answers — the UI can load before the hub is up.
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      try {
        const { configured: yes } = await superadmin.status()
        if (!stop) setConfigured(yes)
      } catch {
        if (!stop) timer = setTimeout(() => void check(), 3000)
      }
    }
    void check()
    return () => { stop = true; clearTimeout(timer) }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Either identifier: `code` is what a real browser sends (and the only one
      // that survives macOS's Option remapping), `key` is what some remote
      // desktops and on-screen keyboards send without a `code` at all.
      const isA = e.code === SHORTCUT.code || e.key.toLowerCase() === 'a'
      if (isA && e.ctrlKey === SHORTCUT.ctrl && e.altKey === SHORTCUT.alt && e.shiftKey === SHORTCUT.shift) {
        e.preventDefault()
        setError(null)
        setPassword('')
        setAsking((was) => (open ? false : !was))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { token } = await superadmin.login(password)
      setSuperadminToken(token)
      setAsking(false)
      setPassword('')
      setOpen(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub.')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  const leave = () => {
    void superadmin.logout().catch(() => {})
    setSuperadminToken(null)
    setOpen(false)
  }

  if (open) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, overflow: 'auto', background: 'var(--bg)' }}>
        <Superadmin onExit={leave} />
      </div>
    )
  }

  if (configured === false) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, overflow: 'auto', background: 'var(--bg)' }}>
        <FirstRunSetup onDone={(token) => {
          setSuperadminToken(token)
          setConfigured(true)
          setOpen(true)
        }} />
      </div>
    )
  }

  if (!asking) return null

  return (
    <div style={{ position: 'relative', zIndex: 100 }}>
      <Modal
        title="Superadmin"
        subtitle="Higher access, for when an admin PIN has been lost."
        onClose={() => setAsking(false)}
        width={440}
      >
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field label="Password">
          <input
            style={inputStyle}
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password !== '' && !busy) void submit()
              if (e.key === 'Escape') setAsking(false)
            }}
          />
        </Field>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <Button onClick={() => setAsking(false)}>Cancel</Button>
          <Button variant="primary" disabled={busy || password === ''} onClick={() => void submit()}>
            {busy ? 'Checking…' : 'Enter'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

/**
 * First run: no superadmin password, no admin, no trial. Whoever installs the
 * hub chooses the superadmin password here; the superadmin screen then opens
 * on its setup checklist — add the first admin, then grant a trial or activate
 * a licence key.
 */
function FirstRunSetup({ onDone }: { onDone: (token: string) => void }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = password.length >= 8 && password === again && !busy

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { token } = await superadmin.setup(password)
      onDone(token)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ width: 520, maxWidth: '100%', padding: 32, display: 'grid', gap: 16 }}>
        <div>
          <h1>First-time setup</h1>
          <div className="muted" style={{ marginTop: 6 }}>
            This hub is new. Choose the superadmin password — it manages the admins and the licence of this
            installation. Then you will add the first admin and start the trial.
          </div>
        </div>
        <ol className="muted" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4, fontSize: 14 }}>
          <li style={{ color: 'var(--text)', fontWeight: 600 }}>Superadmin password</li>
          <li>First admin and their starting PIN</li>
          <li>Trial or licence key</li>
        </ol>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field label="Superadmin password (at least 8 characters)">
          <input style={inputStyle} type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Type it again">
          <input
            style={inputStyle} type="password" value={again}
            onChange={(e) => setAgain(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ready) void submit() }}
          />
        </Field>
        {again !== '' && password !== again ? <Banner tone="warning">The two passwords do not match.</Banner> : null}
        <div className="faint" style={{ fontSize: 13 }}>
          Write it down. It is stored hashed and cannot be shown again.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" disabled={!ready} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Save and continue'}
          </Button>
        </div>
      </div>
    </div>
  )
}
