import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { Login } from '../screens/Login'
import { OpenCounter } from '../screens/OpenCounter'
import { timeLeft } from '../licence'
import { useStore } from '../store'
import { isAdminPath } from './nav'
import { Banner, Button } from './ui'
import { PrintQueue } from './PrintQueue'
import { TopBar } from './TopBar'

export function Shell() {
  const {
    data, error, load, refreshPrinters, refreshJobs, queueOpen, setQueueOpen, operator, counterId, setAdminUnlocked,
  } = useStore()
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null)
  const [canOpen, setCanOpen] = useState(true)
  const { pathname } = useLocation()

  // Leaving the admin area locks it again: the next visit asks for the PIN.
  useEffect(() => {
    if (!isAdminPath(pathname)) setAdminUnlocked(false)
  }, [pathname, setAdminUnlocked])

  /**
   * Nothing can be settled without an open shift, so the app is gated on one.
   * Re-checked periodically because closing the shift on the Shift screen must
   * send the cashier back to the open-counter step.
   */
  const checkShift = useCallback(async () => {
    if (!counterId) return
    try {
      const shift = await api.currentShift(counterId)
      setShiftOpen(shift.open)
      setCanOpen(shift.canOpen)
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

  // Job counts are one cheap query, so they refresh faster than the printer pings.
  useEffect(() => {
    void refreshJobs()
    const t = setInterval(() => { void refreshJobs() }, 10_000)
    return () => clearInterval(t)
  }, [refreshJobs])

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
  // Payments need an open shift, so the app is gated on one. The hub says when
  // a shift cannot be opened (licence expired and nothing left to settle);
  // then let the cashier in to read reports and renew instead of trapping them.
  const expired = data.licence?.state === 'expired' || data.licence?.state === 'unlicensed'
  if (shiftOpen === false && canOpen) return <OpenCounter onOpened={() => setShiftOpen(true)} />

  const lapsed = data.licence?.state === 'unlicensed'
    ? 'No licence or trial yet — new orders and shifts are blocked. Activate a key, or ask your supplier for a trial.'
    : expired
    ? `${data.licence?.plan === 'trial' ? 'The free trial has ended' : 'The licence has expired'}. New orders are blocked; open orders can still be billed and settled.`
    : `${data.licence?.plan === 'trial' ? 'Free trial' : 'Licence'} ends in ${timeLeft(data.licence?.msLeft ?? 0)}.`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <TopBar />

      {/* A slim strip, not a banner inside the screen: it must not push the floor down. */}
      {data.licence?.warning ? (
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', fontSize: 14,
          fontWeight: 600, color: expired ? 'var(--danger)' : '#92400e',
          background: `color-mix(in srgb, ${expired ? 'var(--danger)' : 'var(--warning)'} 14%, var(--surface))`,
          borderBottom: `1px solid ${expired ? 'var(--danger)' : 'var(--warning)'}`,
        }}>
          <span style={{ flex: 1 }}>{lapsed}</span>
          <NavLink to="/licence" style={{ color: 'inherit', padding: '6px 4px' }}>Open Licence</NavLink>
        </div>
      ) : null}

      <main style={{ flex: 1, overflow: 'auto', padding: 16, minWidth: 0, minHeight: 0 }}>
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
      {queueOpen ? <PrintQueue onClose={() => setQueueOpen(false)} /> : null}
    </div>
  )
}
