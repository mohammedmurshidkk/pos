import { useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { ZReport } from '../api/types'
import { Banner, Button, Field, inputStyle } from '../components/ui'
import { useStore } from '../store'

/**
 * Opening the till.
 *
 * Nothing can be settled until a shift is open, because every payment and
 * drawer expense is stamped with the shift — that is what makes the Z-report
 * reconcile at close. So this stands between sign-in and the rest of the app.
 */
export function OpenCounter({ onOpened }: { onOpened: () => void }) {
  const { data, operator, counterId, setCounter, signOut, money } = useStore()
  const [float, setFloat] = useState('500')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const decimals = data?.settings.currencyDecimals ?? 2
  const counters = data?.counters ?? []

  useEffect(() => {
    if (!counterId && counters[0]) setCounter(counters[0].id)
  }, [counterId, counters, setCounter])

  const open = async () => {
    if (!operator || !counterId) return setError('Choose a counter first.')
    const minor = Math.round(Number(float || 0) * 10 ** decimals)
    if (minor < 0) return setError('The opening float cannot be negative.')
    setBusy(true)
    setError(null)
    try {
      await api.openShift({ counterId, employeeId: operator.id, openingFloat: minor })
      onOpened()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ width: 560, maxWidth: '100%', padding: 32, display: 'grid', gap: 20 }}>
        <div>
          <h1>Open the counter</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            Signed in as {operator?.name}. Count the cash in the drawer before you start.
          </div>
        </div>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        {counters.length > 1 ? (
          <Field label="Counter">
            <select style={inputStyle} value={counterId ?? ''} onChange={(e) => setCounter(e.target.value)}>
              {counters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        ) : (
          <div>
            <div className="label">Counter</div>
            <div style={{ fontWeight: 600 }}>{counters[0]?.name ?? '—'}</div>
          </div>
        )}

        <Field label={`Opening float (${data?.settings.currencyDisplay ?? ''})`}>
          <input
            autoFocus
            style={{ ...inputStyle, height: 56, fontSize: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
            value={float}
            inputMode="decimal"
            onChange={(e) => setFloat(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void open() }}
          />
        </Field>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[0, 200, 500, 1000].map((v) => (
            <Button key={v} onClick={() => setFloat(String(v))}>{money(v * 10 ** decimals)}</Button>
          ))}
        </div>

        <div className="faint" style={{ fontSize: 13 }}>
          This is the cash already in the drawer. At close, the Z-report checks it against
          cash sales minus any expenses paid out.
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
          <Button variant="ghost" onClick={signOut}>Sign out</Button>
          <Button variant="primary" disabled={busy} onClick={() => void open()}>
            {busy ? 'Opening…' : 'Open counter'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Shown once, straight after the shift is closed, before the open-counter
 * screen. Without it the Shift screen just turned into "Open the counter" and
 * cashiers could not tell whether the close had worked.
 */
export function CounterClosed({ closed, onDone }: {
  closed: { report: ZReport; backupError: string | null }
  onDone: () => void
}) {
  const { money, signOut } = useStore()
  const { report, backupError } = closed
  const variance = report.cash.variance

  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ width: 520, maxWidth: '100%', padding: 32, display: 'grid', gap: 20 }}>
        <div style={{ display: 'grid', justifyItems: 'center', gap: 12, textAlign: 'center' }}>
          <span style={{
            width: 72, height: 72, borderRadius: 36, display: 'grid', placeItems: 'center',
            background: 'color-mix(in srgb, var(--success) 14%, var(--surface))', color: 'var(--success)',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" fill="none"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h1>Counter closed</h1>
          <div className="muted">
            {report.counterName} · {report.cashierName}. This shift is finished.
          </div>
        </div>

        <div className="card" style={{ padding: 16, display: 'grid', gap: 8, background: 'var(--surface-alt)' }}>
          <Row label="Total sales" value={money(report.grandTotal)} />
          <Row label="Expected in drawer" value={money(report.cash.expected)} />
          {report.cash.counted != null ? <Row label="Counted cash" value={money(report.cash.counted)} /> : null}
          {variance != null ? (
            <Row
              label={variance === 0 ? 'Drawer balanced' : variance > 0 ? 'Over' : 'Short'}
              value={money(variance)}
              tone={variance === 0 ? 'var(--success)' : 'var(--danger)'}
            />
          ) : null}
        </div>

        {backupError
          ? <Banner tone="warning">The backup failed. Check Settings → Backup. ({backupError})</Banner>
          : <Banner tone="success">Backup written.</Banner>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          <Button onClick={() => { onDone(); signOut() }} style={{ minHeight: 52 }}>Sign out</Button>
          <Button variant="primary" onClick={onDone} style={{ minHeight: 52 }}>OK</Button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
      <span className="muted" style={{ color: tone }}>{label}</span>
      <span className="money" style={{ color: tone, fontWeight: 600 }}>{value}</span>
    </div>
  )
}
