import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../api/client'
import { Login } from '../screens/Login'
import { OpenCounter } from '../screens/OpenCounter'
import { useStore } from '../store'
import { Banner, Button } from './ui'

const NAV = [
  { to: '/billing', label: 'Billing' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/shift', label: 'Shift' },
  { to: '/printers', label: 'Printers' },
  { to: '/masters', label: 'Setup' },
  { to: '/devices', label: 'Devices' },
  { to: '/licence', label: 'Licence' },
]

/**
 * The printer strip lives in the header at all times. Support staff work off
 * it, and a cashier needs to see a dead kitchen printer without hunting.
 */
function PrinterStrip() {
  const printers = useStore((s) => s.printers)
  if (printers.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      {printers.map((p) => (
        <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{
            width: 9, height: 9, borderRadius: 5,
            background: p.online ? 'var(--success)' : 'var(--danger)',
          }} />
          <span className="muted">{p.name.replace(' Kitchen', '').replace(' Printer', '')}</span>
        </span>
      ))}
    </div>
  )
}

function OperatorChip() {
  const { operator, signOut } = useStore()
  if (!operator) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontWeight: 600 }}>{operator.name}</span>
      <Button variant="ghost" onClick={signOut}>Sign out</Button>
    </div>
  )
}

export function Shell() {
  const { data, error, load, refreshPrinters, operator, counterId } = useStore()
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null)

  /**
   * Nothing can be settled without an open shift, so the app is gated on one.
   * Re-checked periodically because closing the shift on the Shift screen must
   * send the cashier back to the open-counter step.
   */
  const checkShift = useCallback(async () => {
    if (!counterId) return
    try {
      setShiftOpen((await api.currentShift(counterId)).open)
    } catch {
      setShiftOpen(null)
    }
  }, [counterId])

  useEffect(() => {
    if (!operator) return
    void checkShift()
    const t = setInterval(() => { void checkShift() }, 10_000)
    return () => clearInterval(t)
  }, [operator, checkShift])

  /**
   * Keep trying until the hub answers. Restarting the hub used to leave the
   * cashier staring at an error until somebody clicked Retry — the screen
   * should come back by itself.
   */
  useEffect(() => {
    void load()
    if (data) return
    const t = setInterval(() => { void load() }, 5000)
    return () => clearInterval(t)
  }, [load, data])

  useEffect(() => {
    void refreshPrinters()
    const t = setInterval(() => { void refreshPrinters() }, 30_000)
    return () => clearInterval(t)
  }, [refreshPrinters])

  if (!data) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="card" style={{ padding: 32, display: 'grid', gap: 16, minWidth: 380 }}>
          <h2>{error ? 'Cannot reach the hub' : 'Starting…'}</h2>
          {error ? (
            <>
              <div className="muted">{error}</div>
              <Button variant="primary" onClick={() => void load()}>Retry</Button>
            </>
          ) : null}
        </div>
      </div>
    )
  }

  if (!operator) return <Login />
  // An expired licence cannot open a shift, so do not trap the cashier on that
  // step — let them into the app to settle open orders, read reports and renew.
  const expired = data.licence?.state === 'expired'
  if (shiftOpen === false && !expired) return <OpenCounter onOpened={() => setShiftOpen(true)} />

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', height: '100%' }}>
      <nav style={{
        background: 'var(--surface)', borderRight: '1px solid var(--border)',
        padding: 16, display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 12 }}>
          {data?.settings.businessName ?? 'POS'}
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            style={({ isActive }) => ({
              height: 'var(--row-h)', display: 'flex', alignItems: 'center',
              padding: '0 12px', borderRadius: 'var(--r-button)', textDecoration: 'none',
              fontWeight: 600,
              color: isActive ? 'var(--primary)' : 'var(--text-muted)',
              background: isActive ? 'var(--primary-subtle)' : 'transparent',
            })}
          >
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{
          height: 56, flexShrink: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 24, padding: '0 20px',
          background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        }}>
          <PrinterStrip />
          <OperatorChip />
        </header>

        <main style={{ flex: 1, overflow: 'auto', padding: 20, minWidth: 0 }}>
          {data.licence?.warning ? (
            <div style={{ marginBottom: 16 }}>
              <Banner tone={expired ? 'danger' : 'warning'}>
                <span style={{ flex: 1 }}>
                  {expired
                    ? `${data.licence.plan === 'trial' ? 'The free trial has ended' : 'The licence has expired'}. New orders and shifts are blocked; open orders can still be settled.`
                    : `${data.licence.plan === 'trial' ? 'Free trial' : 'Licence'} ends in ${data.licence.daysLeft} day${data.licence.daysLeft === 1 ? '' : 's'}.`}
                </span>
                <NavLink to="/licence" style={{ fontWeight: 600, color: 'inherit' }}>Open Licence</NavLink>
              </Banner>
            </div>
          ) : null}
          {error ? (
            <div style={{ marginBottom: 16 }}>
              <Banner tone="danger">
                <span style={{ flex: 1 }}>{error}</span>
                <Button variant="secondary" onClick={() => void load()}>Retry</Button>
              </Banner>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  )
}
