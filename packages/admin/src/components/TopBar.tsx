import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { brand } from '../brand'
import '../desktop'
import { useStore } from '../store'
import { PinConfirm } from './AdminGate'
import { MORE, QUICK, moreScreenFor } from './nav'
import { Banner, Button, Field, Modal, initials, inputStyle } from './ui'

export const TOP_BAR_H = 64
const CONTROL_H = 48

/**
 * The till's only navigation: one bar across the top, no sidebar, so the floor
 * and the menu grid get the full width of the screen.
 *
 *   Business · [Floor][Billing] [+ New order] ······ Printers · More · Name ▾
 *
 * Every control is 48px high: this is a touch screen, often with no mouse.
 */
export function TopBar() {
  const { data } = useStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const inOrder = pathname.startsWith('/order/')
  const current = moreScreenFor(pathname)

  // Opening a screen closes the sheet.
  useEffect(() => { setMoreOpen(false) }, [pathname])

  return (
    <>
      <header style={{
        height: TOP_BAR_H, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 12px', background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          fontWeight: 700, fontSize: 17, maxWidth: 200, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 8px',
        }}>
          {data?.settings.businessName ?? brand.productName}
        </div>

        <nav style={{
          display: 'flex', gap: 4, padding: 4, borderRadius: 'calc(var(--r-button) + 4px)',
          background: 'var(--surface-alt)', border: '1px solid var(--border)',
        }}>
          {QUICK.map((q) => (
            <NavLink
              key={q.to}
              to={q.to}
              style={({ isActive }) => ({
                height: CONTROL_H - 8, minWidth: 112, padding: '0 20px', display: 'grid', placeItems: 'center',
                borderRadius: 'var(--r-button)', textDecoration: 'none', fontWeight: 600, fontSize: 16,
                color: isActive ? 'var(--on-primary)' : 'var(--text)',
                background: isActive ? 'var(--primary)' : 'transparent',
              })}
            >
              {q.label}
            </NavLink>
          ))}
        </nav>

        <Button
          variant={inOrder ? 'secondary' : 'primary'}
          onClick={() => navigate('/order/new')}
          style={{ minHeight: CONTROL_H, fontSize: 16, padding: '0 20px' }}
        >
          + New order
        </Button>

        <span style={{ flex: 1 }} />

        <PrinterPill />

        <button
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          style={{
            ...barButton,
            borderColor: current || moreOpen ? 'var(--primary)' : 'var(--border-strong)',
            background: current || moreOpen ? 'var(--primary-subtle)' : 'var(--surface)',
            color: current || moreOpen ? 'var(--primary)' : 'var(--text)',
          }}
        >
          <GridIcon />
          {current ? current.label : 'More'}
        </button>

        <UserMenu />
      </header>

      {moreOpen ? <MoreSheet onClose={() => setMoreOpen(false)} /> : null}
    </>
  )
}

const barButton: React.CSSProperties = {
  height: CONTROL_H, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8,
  borderRadius: 'var(--r-button)', border: '1px solid var(--border-strong)', cursor: 'pointer',
  background: 'var(--surface)', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap',
  touchAction: 'manipulation',
}

function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden>
      <rect x="1" y="1" width="6.5" height="6.5" rx="1.5" />
      <rect x="10.5" y="1" width="6.5" height="6.5" rx="1.5" />
      <rect x="1" y="10.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="1.5" />
    </svg>
  )
}

/**
 * One pill instead of a dot per printer: a cashier needs "all good" or "look
 * here", not a list. Tapping it opens the print queue, which has the detail.
 */
function PrinterPill() {
  const { printers, printersChecked, jobCounts, setQueueOpen } = useStore()
  const failed = Object.values(jobCounts).reduce((a, c) => a + c.failed, 0)
  const waiting = Object.values(jobCounts).reduce((a, c) => a + c.pending, 0)
  const offline = printers.filter((p) => !p.online).length
  // Printer pings can still be running; failed tickets must show regardless.
  if (printers.length === 0 && failed + waiting === 0) return null

  const [tone, text] =
    failed ? ['var(--danger)', `${failed} failed`]
    : offline && printersChecked ? ['var(--danger)', `${offline} printer${offline > 1 ? 's' : ''} offline`]
    : waiting ? ['var(--warning)', `${waiting} printing`]
    : ['var(--success)', 'Printers OK']

  return (
    <button
      onClick={() => setQueueOpen(true)}
      style={{
        ...barButton,
        borderColor: tone === 'var(--success)' ? 'var(--border-strong)' : tone,
        color: tone === 'var(--success)' ? 'var(--text)' : tone,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 5, background: tone }} />
      {text}
    </button>
  )
}

/**
 * Daily screens, then reports, then admin (Setup, Settings, Devices, Licence),
 * as big tiles. Admin tiles show only to admins and ask for the PIN again when
 * opened (AdminGate).
 */
function MoreSheet({ onClose }: { onClose: () => void }) {
  const { operator } = useStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: `${TOP_BAR_H}px 0 0 0`, zIndex: 40,
        background: '#0f172a66', display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: 20,
          display: 'grid', gap: 20, maxHeight: '100%', overflow: 'auto',
        }}
      >
        {MORE.filter((g) => !g.adminOnly || operator?.role === 'admin').map((g) => (
          <section key={g.group} style={{ display: 'grid', gap: 10 }}>
            <div className="label">
              {g.group}{g.adminOnly ? ' · asks for your PIN' : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
              {g.screens.map((s) => {
                const on = pathname === s.to
                return (
                  <button
                    key={s.to}
                    onClick={() => { onClose(); navigate(s.to) }}
                    style={{
                      minHeight: 88, padding: '14px 18px', textAlign: 'left', cursor: 'pointer',
                      display: 'grid', alignContent: 'center', gap: 4, borderRadius: 'var(--r-card)',
                      border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
                      background: on ? 'var(--primary-subtle)' : 'var(--surface)',
                      touchAction: 'manipulation',
                    }}
                  >
                    <span style={{ fontSize: 18, fontWeight: 600, color: on ? 'var(--primary)' : 'var(--text)' }}>
                      {s.label}
                    </span>
                    <span className="muted" style={{ fontSize: 14 }}>{s.hint}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
        <Button onClick={onClose} style={{ minHeight: 52, justifySelf: 'end', minWidth: 160 }}>Close</Button>
      </div>
    </div>
  )
}

/**
 * Name ▾ — Change PIN, full screen, Sign out. Kept behind one tap so a stray
 * finger during a rush cannot sign the counter out.
 */
function UserMenu() {
  const { operator, signOut } = useStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [kiosk, setKiosk] = useState<boolean | null>(null)
  const [dialog, setDialog] = useState<'pin' | 'signout' | 'exit-kiosk' | null>(null)

  useEffect(() => {
    if (open && window.desktop) window.desktop.isKiosk().then(setKiosk).catch(() => setKiosk(null))
  }, [open])

  if (!operator) return null

  const pick = (d: typeof dialog) => { setOpen(false); setDialog(d) }

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ ...barButton, paddingLeft: 6 }}>
        <span style={{
          width: 36, height: 36, borderRadius: 18, background: 'var(--primary)', color: 'var(--on-primary)',
          display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700,
        }}>{initials(operator.name)}</span>
        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{operator.name}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 44 }} />
          <div className="card" style={{
            position: 'absolute', right: 0, top: CONTROL_H + 8, zIndex: 45, width: 260, padding: 6,
            display: 'grid', gap: 2, boxShadow: '0 8px 24px #0f172a22',
          }}>
            <MenuItem onClick={() => pick('pin')}>Change PIN</MenuItem>
            {window.desktop && kiosk !== null ? (
              kiosk
                ? <MenuItem onClick={() => pick('exit-kiosk')}>Exit full screen</MenuItem>
                : <MenuItem onClick={() => { setOpen(false); void window.desktop!.setKiosk(true) }}>Full screen</MenuItem>
            ) : null}
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <MenuItem danger onClick={() => pick('signout')}>Sign out</MenuItem>
          </div>
        </>
      ) : null}

      {dialog === 'pin' ? <ChangePin employeeId={operator.id} onClose={() => setDialog(null)} /> : null}

      {dialog === 'signout' ? (
        <Modal title={`Sign out ${operator.name}?`} subtitle="The next person signs in with their own PIN." onClose={() => setDialog(null)} width={440}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Button onClick={() => setDialog(null)} style={{ minHeight: 52 }}>Cancel</Button>
            <Button
              variant="danger"
              style={{ minHeight: 52 }}
              onClick={() => { setDialog(null); navigate('/floor', { replace: true }); signOut() }}
            >
              Sign out
            </Button>
          </div>
        </Modal>
      ) : null}

      {/* Leaving kiosk brings back the Windows taskbar and desktop, so it asks for the PIN. */}
      {dialog === 'exit-kiosk' ? (
        <Modal onClose={() => setDialog(null)} width={420}>
          <PinConfirm
            area="exit-kiosk"
            title="Exit full screen"
            subtitle="The Windows taskbar comes back. Type your PIN."
            onCancel={() => setDialog(null)}
            onConfirmed={() => { setDialog(null); void window.desktop?.setKiosk(false) }}
          />
        </Modal>
      ) : null}
    </div>
  )
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 52, padding: '0 14px', textAlign: 'left', border: 'none', cursor: 'pointer',
        borderRadius: 'var(--r-button)', background: 'transparent', fontWeight: 600, fontSize: 15,
        color: danger ? 'var(--danger)' : 'var(--text)', touchAction: 'manipulation',
      }}
    >
      {children}
    </button>
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
