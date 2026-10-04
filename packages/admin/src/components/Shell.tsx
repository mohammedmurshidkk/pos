import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { Login } from '../screens/Login'
import { OpenCounter } from '../screens/OpenCounter'
import { timeLeft } from '../licence'
import { useStore } from '../store'
import { brand } from '../brand'
import { BrandMark } from './BrandMark'
import { Banner, Button, Field, Modal, inputStyle } from './ui'
import { PrintQueue } from './PrintQueue'

const NAV = [
  { to: '/billing', label: 'Billing' },
  { to: '/floor', label: 'Floor' },
  { to: '/bills', label: 'Bills' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/reports', label: 'Reports' },
  { to: '/shift', label: 'Shift' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/masters', label: 'Setup' },
  { to: '/settings', label: 'Settings' },
  { to: '/devices', label: 'Devices' },
  { to: '/licence', label: 'Licence' },
]

/**
 * The printer strip lives in the header at all times. Support staff work off
 * it, and a cashier needs to see a dead kitchen printer without hunting.
 * Clicking it opens the print queue; a red count means tickets that never
 * reached paper.
 */
function PrinterStrip() {
  const { printers, jobCounts, setQueueOpen } = useStore()
  const failed = Object.values(jobCounts).reduce((a, c) => a + c.failed, 0)
  const waiting = Object.values(jobCounts).reduce((a, c) => a + c.pending, 0)
  // Printer pings can still be running; failed tickets must show regardless.
  if (printers.length === 0 && failed + waiting === 0) return null
  return (
    <button
      onClick={() => setQueueOpen(true)}
      title="Open the print queue"
      style={{
        display: 'flex', gap: 14, alignItems: 'center', background: 'transparent', cursor: 'pointer',
        border: '1px solid transparent', borderRadius: 'var(--r-button)', padding: '6px 8px', color: 'inherit',
      }}
    >
      {printers.map((p) => {
        const c = jobCounts[p.id]
        return (
          <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{
              width: 9, height: 9, borderRadius: 5,
              background: p.online ? 'var(--success)' : 'var(--danger)',
            }} />
            <span className="muted">{p.name.replace(' Kitchen', '').replace(' Printer', '')}</span>
            {c?.failed ? <span style={badge('var(--danger)')}>{c.failed}</span> : null}
          </span>
        )
      })}
      <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
        {failed ? <span style={{ color: 'var(--danger)' }}>{failed} failed</span> : waiting ? `${waiting} waiting` : 'Print queue'}
      </span>
    </button>
  )
}

const badge = (bg: string): React.CSSProperties => ({
  minWidth: 18, height: 18, borderRadius: 9, padding: '0 5px', fontSize: 11, fontWeight: 700,
  background: bg, color: 'white', display: 'grid', placeItems: 'center',
})

function OperatorChip() {
  const { operator, signOut } = useStore()
  const [changing, setChanging] = useState(false)
  if (!operator) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontWeight: 600 }}>{operator.name}</span>
      <Button variant="ghost" onClick={() => setChanging(true)}>Change PIN</Button>
      <Button variant="ghost" onClick={signOut}>Sign out</Button>
      {changing ? <ChangePin employeeId={operator.id} onClose={() => setChanging(false)} /> : null}
    </div>
  )
}

/** Replacing the starting PIN the superadmin handed over — or any time after. */
function ChangePin({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4)
  const ready = current.length === 4 && next.length === 4 && next === again && !busy

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.changePin(employeeId, current, next)
      setDone(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub.')
    } finally {
      setBusy(false)
    }
  }

  const pinInput = (value: string, set: (v: string) => void, autoFocus = false) => (
    <input
      style={{ ...inputStyle, letterSpacing: 6, fontSize: 20 }}
      type="password" inputMode="numeric" autoFocus={autoFocus} value={value}
      onChange={(e) => set(digits(e.target.value))}
      onKeyDown={(e) => { if (e.key === 'Enter' && ready) void submit() }}
    />
  )

  return (
    <Modal title="Change your PIN" subtitle="Four digits. You will use it the next time you sign in." onClose={onClose} width={440}>
      {done ? (
        <>
          <Banner tone="success">Your PIN has been changed.</Banner>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </>
      ) : (
        <>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Field label="Current PIN">{pinInput(current, setCurrent, true)}</Field>
          <Field label="New PIN">{pinInput(next, setNext)}</Field>
          <Field label="New PIN again">{pinInput(again, setAgain)}</Field>
          {again.length === 4 && next !== again ? <Banner tone="warning">The new PINs do not match.</Banner> : null}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!ready} onClick={() => void submit()}>
              {busy ? 'Saving…' : 'Change PIN'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

export function Shell() {
  const { data, error, load, refreshPrinters, refreshJobs, queueOpen, setQueueOpen, operator, counterId } = useStore()
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null)
  const [canOpen, setCanOpen] = useState(true)

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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', height: '100%' }}>
      <nav style={{
        background: 'var(--surface)', borderRight: '1px solid var(--border)',
        padding: 16, display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 12 }}>
          {data?.settings.businessName ?? brand.productName}
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
        <div style={{ marginTop: 'auto', paddingTop: 12 }}><BrandMark /></div>
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
                  {data.licence.state === 'unlicensed'
                    ? 'This hub has no licence or trial yet, so new orders and shifts are blocked. Activate a licence key, or ask your supplier for a trial.'
                    : expired
                    ? `${data.licence.plan === 'trial' ? 'The free trial has ended' : 'The licence has expired'}. New orders are blocked; open orders can still be billed and settled.`
                    : `${data.licence.plan === 'trial' ? 'Free trial' : 'Licence'} ends in ${timeLeft(data.licence.msLeft)}.`}
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
        {queueOpen ? <PrintQueue onClose={() => setQueueOpen(false)} /> : null}
      </div>
    </div>
  )
}
