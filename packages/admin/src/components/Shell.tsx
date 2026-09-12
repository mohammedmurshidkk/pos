import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../store'
import { Banner, Button } from './ui'

const NAV = [
  { to: '/billing', label: 'Billing' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/shift', label: 'Shift' },
  { to: '/printers', label: 'Printers' },
  { to: '/masters', label: 'Setup' },
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

function OperatorPicker() {
  const { data, operator, signIn, signOut } = useStore()
  if (operator) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>{operator.name}</span>
        <Button variant="ghost" onClick={signOut}>Switch</Button>
      </div>
    )
  }
  // Admins settle, discount and void — every one of those is attributed.
  const admins = (data?.employees ?? []).filter((e) => e.role === 'admin')
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span className="muted">Signed in as</span>
      {admins.map((e) => (
        <Button key={e.id} onClick={() => signIn(e)}>{e.name}</Button>
      ))}
    </div>
  )
}

export function Shell() {
  const { data, error, load, refreshPrinters } = useStore()

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
          <OperatorPicker />
        </header>

        <main style={{ flex: 1, overflow: 'auto', padding: 20, minWidth: 0 }}>
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
