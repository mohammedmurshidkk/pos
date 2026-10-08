import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import type { Employee } from '../api/types'
import { brand } from '../brand'
import { BrandMark } from '../components/BrandMark'
import { PIN_LENGTH, PinPad } from '../components/PinPad'
import { OPEN_SUPERADMIN } from '../components/SuperadminDoor'
import { Banner, Button, initials } from '../components/ui'
import { useStore } from '../store'

/** Long enough that nobody opens it by resting a finger on the logo. */
const DOOR_HOLD_MS = 5000

/**
 * A01 — counter sign-in.
 *
 * Only admins can sign in here: the counter settles money, discounts and voids,
 * and every one of those is stamped with whoever is signed in. Waiters use the
 * tablet, which has no login at all — identity is captured per action there.
 */
export function Login() {
  const { data, signIn, counterId } = useStore()
  const navigate = useNavigate()
  const [picked, setPicked] = useState<Employee | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const admins = (data?.employees ?? []).filter((e) => e.role === 'admin')
  const waiters = (data?.employees ?? []).filter((e) => e.role !== 'admin')
  const counter = data?.counters.find((c) => c.id === counterId)

  const submit = async (employee: Employee, code: string) => {
    setBusy(true)
    setError(null)
    try {
      signIn(await api.login(employee.id, code))
      // The floor is home: every sign-in starts there, wherever the last one ended.
      navigate('/floor', { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub.')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  // Submitting on the fourth digit saves a tap fifty times a shift.
  useEffect(() => {
    if (picked && pin.length === PIN_LENGTH && !busy) void submit(picked, pin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, picked])

  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ width: 760, maxWidth: '100%', padding: 32, display: 'grid', gap: 20 }}>
        <div>
          <h1>{data?.settings.businessName ?? brand.productName}</h1>
          <div className="faint" style={{ fontSize: 13, marginTop: 2 }}>
            {counter ? `${counter.name} · ` : ''}Counter sign-in
          </div>
        </div>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <div>
          <div className="label" style={{ marginBottom: 8 }}>Who is at the counter?</div>
          {admins.length === 0 ? (
            <Banner tone="info">
              No admin has been set up yet. Your supplier adds the first admin and gives them a starting PIN.
            </Banner>
          ) : null}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {admins.map((e) => {
              const active = picked?.id === e.id
              const locked = e.hasPin === false
              return (
                <button
                  key={e.id}
                  disabled={locked}
                  onClick={() => { setPicked(e); setPin(''); setError(null) }}
                  title={locked ? 'No PIN set — add one under Setup → Employees' : undefined}
                  style={{
                    width: 150, height: 150, borderRadius: 'var(--r-card)', cursor: locked ? 'not-allowed' : 'pointer',
                    display: 'grid', placeItems: 'center', gap: 8, opacity: locked ? 0.4 : 1,
                    border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                    background: active ? 'var(--primary-subtle)' : 'var(--surface-alt)',
                  }}
                >
                  <span style={{
                    width: 56, height: 56, borderRadius: 28, background: 'var(--primary)',
                    color: 'var(--on-primary)', display: 'grid', placeItems: 'center',
                    fontSize: 18, fontWeight: 600,
                  }}>{initials(e.name)}</span>
                  <span style={{ fontWeight: 600 }}>{e.name}</span>
                  <span className="faint" style={{ fontSize: 12 }}>{locked ? 'No PIN set' : 'Admin'}</span>
                </button>
              )
            })}
          </div>
          {waiters.length > 0 ? (
            <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              {waiters.map((w) => w.name).join(', ')} take orders on the tablet — no sign-in needed there.
            </div>
          ) : null}
        </div>

        {picked ? (
          <div style={{ display: 'grid', gap: 16, justifyItems: 'center' }}>
            <PinPad
              value={pin}
              onChange={setPin}
              onCancel={() => { setPicked(null); setPin('') }}
              busy={busy}
            />
            <Button variant="ghost" onClick={() => { setPicked(null); setPin('') }}>Choose someone else</Button>
          </div>
        ) : null}

        <HiddenDoor><BrandMark /></HiddenDoor>
      </div>
    </div>
  )
}

/**
 * Press and hold the brand mark for five seconds to open Superadmin — the touch
 * twin of Ctrl + Alt + Shift + A, for a till with no keyboard. Like the
 * shortcut it has no label; it is in CLAUDE.md and the handover notes.
 */
function HiddenDoor({ children }: { children: React.ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])
  return (
    <div
      style={{ justifySelf: 'center', padding: 8, userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}
      onPointerDown={() => {
        stop()
        timer.current = setTimeout(() => window.dispatchEvent(new Event(OPEN_SUPERADMIN)), DOOR_HOLD_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // A long touch otherwise opens the browser's context menu.
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {children}
    </div>
  )
}
