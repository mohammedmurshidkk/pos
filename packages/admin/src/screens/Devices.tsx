import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { Device } from '../api/types'
import { Banner, Button, EmptyState, Modal, Pill } from '../components/ui'
import { useStore } from '../store'

const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  return hours < 48 ? `${hours} h ago` : new Date(iso).toLocaleDateString('en-GB')
}

/**
 * A22 — pairing tablets.
 *
 * Only a paired tablet can place orders: without this, anything on the shop
 * wifi could send tickets to the kitchen. The code is shown here, typed once on
 * the tablet, and is worthless after one use or ten minutes.
 */
export function Devices() {
  const operator = useStore((s) => s.operator)
  const [devices, setDevices] = useState<Device[]>([])
  const [addresses, setAddresses] = useState<string[]>([])
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<Device | null>(null)
  const knownIds = useRef<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    try {
      const res = await api.devices()
      // A new active device while a code is showing means the tablet just paired.
      const fresh = res.devices.find((d) => d.active && !knownIds.current.has(d.id))
      if (fresh && knownIds.current.size > 0) {
        setNotice(`${fresh.name} is paired and can take orders.`)
        setCode(null)
      }
      knownIds.current = new Set(res.devices.map((d) => d.id))
      setDevices(res.devices)
      setAddresses(res.addresses)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { void refresh() }, code ? 3000 : 15000)
    return () => clearInterval(t)
  }, [refresh, code])

  useEffect(() => {
    if (!code) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [code])

  const secondsLeft = code ? Math.max(0, Math.round((new Date(code.expiresAt).getTime() - now) / 1000)) : 0
  useEffect(() => { if (code && secondsLeft === 0) setCode(null) }, [code, secondsLeft])

  const issue = async () => {
    if (!operator) return setError('Sign in at the counter first.')
    setError(null)
    setNotice(null)
    try {
      if (knownIds.current.size === 0) knownIds.current = new Set(devices.map((d) => d.id).concat('__seeded__'))
      setCode(await api.pairingCode(operator.id))
      setNow(Date.now())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    }
  }

  const active = devices.filter((d) => d.active)
  const past = devices.filter((d) => !d.active)

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 960 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1>Devices</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            Only paired tablets can take orders. Unpair a tablet the moment it is lost or leaves the shop.
          </div>
        </div>
        {!code ? <Button variant="primary" onClick={() => void issue()}>Pair a tablet</Button> : null}
      </div>

      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}

      {code ? (
        <div className="card" style={{ padding: 28, display: 'grid', gap: 16, justifyItems: 'center', textAlign: 'center' }}>
          <div className="label">On the tablet, open the app and enter</div>
          <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', justifyContent: 'center' }}>
            <div>
              <div className="faint" style={{ fontSize: 13 }}>Hub address</div>
              <div style={{ fontSize: 26, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>
                {addresses[0] ?? 'this PC'}
              </div>
              <div className="faint" style={{ fontSize: 13 }}>port 4000</div>
            </div>
            <div>
              <div className="faint" style={{ fontSize: 13 }}>Pairing code</div>
              <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: 10, fontFamily: 'ui-monospace, monospace' }}>
                {code.code}
              </div>
              <div className="faint" style={{ fontSize: 13 }}>
                expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
              </div>
            </div>
          </div>
          {addresses.length > 1 ? (
            <div className="muted" style={{ fontSize: 13 }}>
              This PC has several addresses. If the first does not work, try {addresses.slice(1).join(' or ')}.
            </div>
          ) : null}
          <div className="muted" style={{ fontSize: 13 }}>The code works once. This screen updates when the tablet pairs.</div>
          <Button onClick={async () => { await api.cancelPairingCode().catch(() => {}); setCode(null) }}>Cancel</Button>
        </div>
      ) : null}

      <div className="card" style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Name', 'Status', 'Last seen', 'Paired on', ''].map((h, i) => (
                <th key={h || i} style={{
                  textAlign: 'left', fontSize: 13, fontWeight: 500, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: 'var(--text-muted)', padding: '10px 12px',
                  borderBottom: '1px solid var(--border)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr><td colSpan={5}><EmptyState title="No tablets paired yet" hint="Press Pair a tablet to add the first one." /></td></tr>
            ) : [...active, ...past].map((d) => (
              <tr key={d.id} style={{ height: 'var(--row-h)', borderTop: '1px solid var(--border)', opacity: d.active ? 1 : 0.5 }}>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{d.name}</td>
                <td style={{ padding: '8px 12px' }}>
                  {d.active ? <Pill label="Paired" tone="success" /> : <span className="faint">Unpaired</span>}
                </td>
                <td style={{ padding: '8px 12px' }} className="muted">{ago(d.lastSeen)}</td>
                <td style={{ padding: '8px 12px' }} className="muted">{new Date(d.createdAt).toLocaleDateString('en-GB')}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  {d.active ? <Button variant="ghost" onClick={() => setRevoking(d)}>Unpair</Button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {revoking ? (
        <Modal
          title={`Unpair ${revoking.name}?`}
          subtitle="It stops taking orders immediately. Orders it has already queued stay on the tablet until it is paired again."
          onClose={() => setRevoking(null)}
          width={500}
        >
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Button onClick={() => setRevoking(null)}>Cancel</Button>
            <Button variant="danger" onClick={async () => {
              const target = revoking
              setRevoking(null)
              if (!operator) return setError('Sign in at the counter first.')
              try {
                await api.revokeDevice(target.id, operator.id)
                setNotice(`${target.name} has been unpaired.`)
                await refresh()
              } catch (e) {
                setError(e instanceof ApiError ? e.message : 'Something went wrong.')
              }
            }}>Unpair</Button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
