import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { DayCloseSummary, DayReport } from '../api/types'
import { Banner, Button, EmptyState, Modal } from '../components/ui'
import { useStore } from '../store'

/**
 * Counter day close, after the last shift.
 *
 * A 24-hour shop runs several shifts, each closed with its own Z-report. This
 * takes every shift closed on the counter since the previous day close and
 * prints one report: a section per shift, then the counter's totals. The
 * preview is what will print, so the cashier checks it before committing.
 */
export function DayCloseModal({ onClose }: { onClose: () => void }) {
  const { operator, counterId, money } = useStore()
  // A field the hub did not send (an older hub still running) shows as a dash, never NaN.
  const amount = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? money(v) : '—')
  const [preview, setPreview] = useState<{ shiftOpen: boolean; report: DayReport } | null>(null)
  const [done, setDone] = useState<DayReport | null>(null)
  const [past, setPast] = useState<DayCloseSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!counterId) return
    try {
      const [p, list] = await Promise.all([api.dayClosePreview(counterId), api.dayCloses(counterId)])
      setPreview(p)
      setPast(list)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub.')
    }
  }, [counterId])

  useEffect(() => { void load() }, [load])

  const close = async () => {
    if (!operator || !counterId) return setError('Sign in at the counter first.')
    setBusy(true)
    setError(null)
    try {
      setDone(await api.closeDay({ counterId, employeeId: operator.id }))
      void load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const reprint = async (id: string) => {
    if (!operator) return
    try {
      await api.reprintDayClose(id, operator.id)
      setNotice('Day report sent to the printer.')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    }
  }

  const report = done ?? preview?.report ?? null
  const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

  return (
    <Modal
      title={done ? 'Day closed' : 'Close day'}
      subtitle={report ? `${report.counterName} · ${when(report.from)} to ${when(report.to)}` : undefined}
      onClose={onClose}
      width={880}
    >
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {done ? <Banner tone="success">The day report is printing: {done.shifts.length} shift(s) and the counter totals.</Banner> : null}
      {!done && preview?.shiftOpen ? (
        <Banner tone="warning">A shift is still open on this counter. Close it first; the day close comes after the last shift.</Banner>
      ) : null}

      {!report ? <EmptyState title="Loading…" /> : report.shifts.length === 0 ? (
        <EmptyState title="No shifts to close" hint="Every closed shift is already on a day close." />
      ) : (
        <>
          {/* The modal is a scrolling flex column: without flexShrink 0 this card is squeezed to its header. */}
          <div className="card" style={{ padding: 0, overflowX: 'auto', flexShrink: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr className="label" style={{ textAlign: 'left' }}>
                  <Th>Shift</Th><Th>Cashier</Th><Th>Opened</Th><Th>Closed</Th>
                  <Th right>Sales</Th><Th right>Expenses</Th><Th right>Variance</Th>
                </tr>
              </thead>
              <tbody>
                {report.shifts.map((z, i) => (
                  <tr key={z.shiftId} style={{ borderTop: '1px solid var(--border)' }}>
                    <Td>{i + 1}</Td>
                    <Td>{z.cashierName}</Td>
                    <Td>{when(z.openedAt)}</Td>
                    <Td>{when(z.closedAt)}</Td>
                    <Td right money>{amount(z.grandTotal)}</Td>
                    <Td right money>{amount(z.cash.drawerExpenses)}</Td>
                    <Td right money tone={z.cash.variance ? 'var(--danger)' : 'var(--success)'}>
                      {z.cash.variance == null ? '—' : amount(z.cash.variance)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start', flexShrink: 0 }}>
            <div className="card" style={{ padding: 16, display: 'grid', gap: 8 }}>
              <h2>Counter sales</h2>
              {report.totals.paymentModes.map((m) => (
                <Line key={m.name} label={`${m.name} (${m.count})`} value={amount(m.total)} />
              ))}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <Line label="Total sales" value={amount(report.totals.grandTotal)} bold />
              </div>
              <Line label={`Discounts (${report.totals.discounts.count})`} value={amount(report.totals.discounts.total)} />
              <Line label={`Voids (${report.totals.voids.count})`} value={amount(report.totals.voids.total)} />
              <Line label="VAT collected" value={amount(report.totals.vatCollected)} />
              <Line
                label="Invoices"
                value={report.totals.invoiceRange.from == null ? 'none' : `${report.totals.invoiceRange.from} – ${report.totals.invoiceRange.to}`}
              />
            </div>

            <div className="card" style={{ padding: 16, display: 'grid', gap: 8 }}>
              <h2>Expenses</h2>
              {report.totals.expenses.byCategory.map((e) => (
                <Line key={e.category} label={`${e.category} (${e.count})`} value={amount(e.total)} />
              ))}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <Line label="Total expenses" value={amount(report.totals.expenses.total)} bold />
              </div>
              <h2 style={{ marginTop: 8 }}>Cash (all shifts)</h2>
              <Line label="Opening floats" value={amount(report.totals.cash.openingFloats)} />
              <Line label="+ Cash sales" value={amount(report.totals.cash.cashSales)} />
              <Line label="− Expenses from drawer" value={amount(report.totals.cash.drawerExpenses)} />
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <Line label="Expected" value={amount(report.totals.cash.expected)} />
              </div>
              <Line label="Counted" value={amount(report.totals.cash.counted)} />
              <Line
                label="Variance"
                value={amount(report.totals.cash.variance)}
                bold
                tone={report.totals.cash.variance === 0 ? 'var(--success)' : 'var(--danger)'}
              />
            </div>
          </div>
        </>
      )}

      {past.length > 0 ? (
        <div style={{ display: 'grid', gap: 6, flexShrink: 0 }}>
          <div className="label">Earlier day closes</div>
          {past.slice(0, 5).map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1 }} className="muted">
                {when(d.closedAt)} · {d.shiftCount} shift(s){d.closedBy ? ` · ${d.closedBy}` : ''}
              </span>
              <span className="money">{amount(d.grandTotal)}</span>
              <Button variant="ghost" style={{ minHeight: 32 }} onClick={() => void reprint(d.id)}>Reprint</Button>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{done ? 'Done' : 'Cancel'}</Button>
        {!done ? (
          <Button
            variant="primary"
            disabled={busy || !preview || preview.shiftOpen || preview.report.shifts.length === 0}
            onClick={() => void close()}
          >
            {busy ? 'Closing…' : 'Close day & print report'}
          </Button>
        ) : null}
      </div>
    </Modal>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th style={{ padding: '10px 12px', textAlign: right ? 'right' : 'left', fontWeight: 600 }}>{children}</th>
}

function Td({ children, right, money, tone }: { children: React.ReactNode; right?: boolean; money?: boolean; tone?: string }) {
  return (
    <td className={money ? 'money' : undefined} style={{ padding: '10px 12px', textAlign: right ? 'right' : 'left', color: tone }}>
      {children}
    </td>
  )
}

function Line({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
      <span className={bold ? undefined : 'muted'} style={{ fontWeight: bold ? 600 : 400, color: tone }}>{label}</span>
      <span className="money" style={{ color: tone, fontWeight: bold ? 600 : undefined }}>{value}</span>
    </div>
  )
}
