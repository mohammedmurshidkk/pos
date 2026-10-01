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
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
