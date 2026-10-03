import { useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { Employee } from '../api/types'
import { Banner, Button } from '../components/ui'
import { useStore } from '../store'

const PIN_LENGTH = 4
/** Two letters: initials for a full name, the first two for a single name. */
const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const source = parts.length > 1 ? parts.map((p) => p[0] ?? '').join('') : (parts[0] ?? '')
  return source.slice(0, 2).toUpperCase()
}

/**
 * A01 — counter sign-in.
 *
 * Only admins can sign in here: the counter settles money, discounts and voids,
 * and every one of those is stamped with whoever is signed in. Waiters use the
 * tablet, which has no login at all — identity is captured per action there.
 */
export function Login() {
  const { data, signIn, counterId } = useStore()
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

  // The keypad is there for a touch till; a keyboard is faster on a desktop PC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!picked) return
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < PIN_LENGTH ? p + e.key : p))
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Escape') { setPicked(null); setPin('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked])

  const key = (label: string, onClick: () => void, disabled = false) => (
    <button
      key={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 72, fontSize: 26, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
        background: disabled ? 'transparent' : 'var(--surface)',
        border: disabled ? 'none' : '1px solid var(--border)',
        borderRadius: 'var(--r-button)',
      }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ width: 760, maxWidth: '100%', padding: 32, display: 'grid', gap: 20 }}>
        <div>
          <h1>{data?.settings.businessName ?? 'POS'}</h1>
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
            <div style={{ display: 'flex', gap: 12 }}>
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <span key={i} style={{
                  width: 14, height: 14, borderRadius: 7,
                  background: i < pin.length ? 'var(--primary)' : 'transparent',
                  border: `2px solid ${i < pin.length ? 'var(--primary)' : 'var(--border-strong)'}`,
                }} />
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 88px)', gap: 10 }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) =>
                key(n, () => setPin((p) => (p.length < PIN_LENGTH ? p + n : p))))}
              {key('', () => {}, true)}
              {key('0', () => setPin((p) => (p.length < PIN_LENGTH ? p + '0' : p)))}
              {key('⌫', () => setPin((p) => p.slice(0, -1)))}
            </div>

            <div className="faint" style={{ fontSize: 12 }}>
              {busy ? 'Checking…' : 'Type the PIN, or use the number keys'}
            </div>
            <Button variant="ghost" onClick={() => { setPicked(null); setPin('') }}>Choose someone else</Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
