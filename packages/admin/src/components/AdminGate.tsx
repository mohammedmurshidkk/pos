import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { useStore } from '../store'
import { PIN_LENGTH, PinPad } from './PinPad'
import { Banner, Button } from './ui'

/**
 * The signed-in admin types their PIN again. Same lockout as sign-in, audited
 * as `auth.unlock` with the area, so the log shows who went into the back office.
 */
export function PinConfirm({ area, title, subtitle, onConfirmed, onCancel }: {
  area: string
  title: string
  subtitle: string
  onConfirmed: () => void
  onCancel: () => void
}) {
  const { operator } = useStore()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!operator || pin.length !== PIN_LENGTH || busy) return
    setBusy(true)
    setError(null)
    api.confirmPin(operator.id, pin, area)
      .then(onConfirmed)
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : 'Could not reach the hub.')
        setPin('')
      })
      .finally(() => setBusy(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  return (
    <div style={{ display: 'grid', gap: 20, justifyItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <h1>{title}</h1>
        <div className="muted" style={{ marginTop: 4 }}>{subtitle}</div>
      </div>
      {error ? <div style={{ width: '100%' }}><Banner tone="danger">{error}</Banner></div> : null}
      <PinPad value={pin} onChange={setPin} onCancel={onCancel} busy={busy}
        hint={operator ? `${operator.name}'s PIN` : undefined} />
      <Button onClick={onCancel} style={{ minWidth: 200, minHeight: 52 }}>Cancel</Button>
    </div>
  )
}

/**
 * Setup, Settings, Devices and Licence ask for the PIN again on the way in.
 * Moving between them does not ask twice; leaving the admin area (Shell drops
 * the unlock) or signing out does.
 *
 * Only admins sign in at the counter today, but the gate checks the role anyway
 * so a future cashier login cannot reach these screens.
 */
export function AdminGate({ area, children }: { area: string; children: ReactNode }) {
  const { operator, adminUnlocked, setAdminUnlocked } = useStore()
  const navigate = useNavigate()
  // 'default' means this is the first screen in the app's history: nothing to go back to.
  const canGoBack = useLocation().key !== 'default'

  if (operator?.role !== 'admin') {
    return (
      <div className="card" style={{ maxWidth: 480, margin: '48px auto', padding: 32, display: 'grid', gap: 16 }}>
        <h1>Admins only</h1>
        <div className="muted">Ask an admin to open this screen.</div>
        <Button variant="primary" onClick={() => navigate('/floor')}>Back to the floor</Button>
      </div>
    )
  }

  if (adminUnlocked) return <>{children}</>

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100%', padding: 16 }}>
      <div className="card" style={{ width: 420, maxWidth: '100%', padding: 32 }}>
        <PinConfirm
          area={area}
          title="Admin area"
          subtitle="Type your PIN again to continue."
          onConfirmed={() => setAdminUnlocked(true)}
          onCancel={() => (canGoBack ? navigate(-1) : navigate('/floor'))}
        />
      </div>
    </div>
  )
}
