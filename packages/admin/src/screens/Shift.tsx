import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { ZReport } from '../api/types'
import { Banner, Button, EmptyState, Field, inputStyle } from '../components/ui'
import { useStore } from '../store'
import { ExpenseModal } from './Expenses'

/**
 * A19 — shift open and close.
 *
 * The Z-report is the screen the owner judges the product on, so the cash
 * reconciliation is shown as an arithmetic the cashier can follow line by line
 * rather than a single "variance" number to be taken on trust.
 */
export function Shift() {
  const { data, operator, counterId, money, setClosedShift } = useStore()
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [report, setReport] = useState<ZReport | null>(null)
  const [float, setFloat] = useState('500')
  const [counted, setCounted] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [payingOut, setPayingOut] = useState(false)

  const decimals = data?.settings.currencyDecimals ?? 2
  const toMinor = (v: string) => Math.round(Number(v || 0) * 10 ** decimals)

  const refresh = useCallback(async () => {
    if (!counterId) return
    try {
      const { shiftId: id } = await api.currentShift(counterId)
      setShiftId(id)
      setReport(id ? await api.zReport(id) : null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [counterId])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { void refresh() }, 10_000)
    return () => clearInterval(t)
  }, [refresh])

  const guard = () => {
    if (!operator) { setError('Sign in at the counter first.'); return false }
    if (!counterId) { setError('No counter configured.'); return false }
    return true
  }

  const variance = report && counted !== ''
    ? toMinor(counted) - report.cash.expected
    : report?.cash.variance ?? null

  if (!shiftId) {
    return (
      <div style={{ display: 'grid', gap: 16, maxWidth: 520 }}>
        <h1>Open Shift</h1>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <div className="card" style={{ padding: 20, display: 'grid', gap: 16 }}>
          <Field label="Opening float">
            <input style={{ ...inputStyle, textAlign: 'right' }} value={float} onChange={(e) => setFloat(e.target.value)} />
          </Field>
          <Button variant="primary" onClick={async () => {
            if (!guard()) return
            try {
              await api.openShift({ counterId: counterId!, employeeId: operator!.id, openingFloat: toMinor(float) })
              await refresh()
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Something went wrong.')
            }
          }}>Open shift</Button>
        </div>
      </div>
    )
  }

  if (!report) return <EmptyState title="Loading shift…" />

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1>Close Shift</h1>
        <div className="muted">
          {report.counterName} · {report.cashierName} · opened {new Date(report.openedAt).toLocaleString('en-GB')}
        </div>
      </div>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card" style={{ padding: 20, display: 'grid', gap: 12 }}>
          <h2>Sales by payment mode</h2>
          {report.paymentModes.map((m) => (
            <Line key={m.name} label={`${m.name} (${m.count})`} value={money(m.total)} />
          ))}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <Line label="Total" value={money(report.grandTotal)} bold />
          </div>

          <h2 style={{ marginTop: 8 }}>Sales by order type</h2>
          {report.orderTypes.map((t) => (
            <Line key={t.type} label={`${t.type.replace('_', '-')} (${t.count})`} value={money(t.total)} />
          ))}

          {report.waiters.length > 0 ? (
            <>
              <h2 style={{ marginTop: 8 }}>Sales by waiter</h2>
              {report.waiters.map((w) => (
                <Line key={w.name} label={`${w.name} (${w.orders})`} value={money(w.total)} />
              ))}
            </>
          ) : null}
        </div>

        <div className="card" style={{ padding: 20, display: 'grid', gap: 12 }}>
          <h2>Cash reconciliation</h2>
          <Line label="Opening float" value={money(report.cash.openingFloat)} />
          <Line label="+ Cash sales" value={money(report.cash.cashSales)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}><Line label="− Expenses from drawer" value={money(report.cash.drawerExpenses)} /></span>
            <Button variant="ghost" style={{ minHeight: 32 }} onClick={() => setPayingOut(true)}>Pay out</Button>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <Line label="Expected in drawer" value={money(report.cash.expected)} bold />
          </div>

          <Field label="Counted cash">
            <input
              style={{ ...inputStyle, textAlign: 'right', fontSize: 20, height: 52 }}
              value={counted}
              inputMode="decimal"
              onChange={(e) => setCounted(e.target.value)}
              placeholder={(report.cash.expected / 10 ** decimals).toFixed(decimals)}
            />
          </Field>

          {variance != null ? (
            <div style={{
              padding: 12, borderRadius: 'var(--r-card)',
              background: variance === 0
                ? 'color-mix(in srgb, var(--success) 8%, transparent)'
                : 'color-mix(in srgb, var(--danger) 8%, transparent)',
            }}>
              <Line
                label="VARIANCE"
                value={money(variance)}
                bold
                tone={variance === 0 ? 'var(--success)' : 'var(--danger)'}
              />
            </div>
          ) : null}

          <div className="card" style={{ padding: 12, display: 'grid', gap: 6, background: 'var(--surface-alt)' }}>
            <Line label={`Discounts (${report.discounts.count})`} value={money(report.discounts.total)} />
            <Line label={`Voids (${report.voids.count})`} value={money(report.voids.total)} />
            <Line label="Saved without KOT" value={String(report.savedWithoutKot)} />
            <Line label={`${data?.settings.taxName ?? 'VAT'} collected`} value={money(report.vatCollected)} />
            <Line
              label="Invoices"
              value={report.invoiceRange.from == null ? 'none' : `${report.invoiceRange.from} – ${report.invoiceRange.to}`}
            />
          </div>

          <Button variant="primary" disabled={counted === ''} onClick={async () => {
            if (!guard()) return
            try {
              const res = await api.closeShift(shiftId, { countedCash: toMinor(counted), employeeId: operator!.id })
              setCounted('')
              // Shell takes over: "Counter closed", then the open-counter screen.
              setClosedShift({
                report: res.report,
                backupError: res.backupPath ? null : res.backupError ?? 'The backup was not written.',
              })
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Something went wrong.')
            }
          }}>
            Close shift & print Z-report
          </Button>
        </div>
      </div>

      {payingOut ? (
        <ExpenseModal onClose={() => setPayingOut(false)} onSaved={() => { setPayingOut(false); void refresh() }} />
      ) : null}
    </div>
  )
}

function Line({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
      <span className={bold ? undefined : 'muted'} style={{ fontWeight: bold ? 600 : 400, color: tone }}>{label}</span>
      <span className="money" style={{ color: tone, fontSize: bold ? 17 : undefined }}>{value}</span>
    </div>
  )
}
