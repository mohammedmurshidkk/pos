import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { ClosedOrder, OrderType, RangePreset } from '../api/types'
import { Banner, Button, EmptyState, Pill } from '../components/ui'
import { RangePicker, rangeQuery } from '../components/RangePicker'
import { useStore } from '../store'

const typeLabel: Record<OrderType, string> = {
  dine_in: 'Dine-in', takeaway: 'Takeaway', car: 'Car', delivery: 'Delivery',
}
const typeColor: Record<OrderType, string> = {
  dine_in: 'var(--dine-in)', takeaway: 'var(--takeaway)',
  car: 'var(--car)', delivery: 'var(--delivery)',
}
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

/**
 * Closed bills — settled and cancelled orders, read-only.
 *
 * Billing only lists open orders, so once a bill was settled there was no way
 * back to it: a customer asking for a copy, or the owner checking what a table
 * paid, had nowhere to look. Reprinting goes through the same bill endpoint as
 * a first print. A settled invoice is never recalculated, so the copy matches
 * the original, with the payments added.
 */
export function Bills() {
  const { data, operator, counterId, money, employeeName } = useStore()
  const [preset, setPreset] = useState<RangePreset>('today')
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10))
  const [status, setStatus] = useState<'settled' | 'void'>('settled')
  const [search, setSearch] = useState('')
  const [orders, setOrders] = useState<ClosedOrder[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await api.closedOrders(rangeQuery(preset, day))
      setOrders(res.orders)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [preset, day])

  useEffect(() => { void refresh() }, [refresh])

  const tableName = (id: string | null) => (id ? data?.tables.find((t) => t.id === id)?.name ?? '' : '')

  const q = search.trim().toLowerCase()
  const shown = orders
    .filter((o) => o.status === status)
    .filter((o) => !q || [
      String(o.orderNo), o.invoiceNo != null ? String(o.invoiceNo) : '',
      `${data?.settings.invoicePrefix ?? ''}${o.invoiceNo ?? ''}`,
      tableName(o.tableId), o.ticketLabel ?? '', o.customerName ?? '', o.phoneSnapshot ?? '', o.vehicleNo ?? '',
    ].some((v) => v.toLowerCase().includes(q)))

  const selected = shown.find((o) => o.id === selectedId) ?? shown[0] ?? null
  const live = selected?.lines.filter((l) => l.status !== 'void') ?? []
  const settledTotal = orders.filter((o) => o.status === 'settled').reduce((t, o) => t + o.total, 0)

  const reprint = async (o: ClosedOrder) => {
    if (!operator || !counterId) return setError('Sign in at the counter first.')
    try {
      await api.printBill(o.id, operator.id, counterId)
      setNotice(`Copy of invoice ${o.invoiceNo} sent to the printer.`)
      setError(null)
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 20, height: '100%', minHeight: 0 }}>
      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2>Closed bills</h2>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>
            {orders.filter((o) => o.status === 'settled').length} settled · <span className="money">{money(settledTotal)}</span>
          </span>
        </div>
        <RangePicker preset={preset} day={day} onPreset={setPreset} onDay={setDay} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="Invoice, order no, table, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1, height: 'var(--control-h)', padding: '0 12px',
              border: '1px solid var(--border-strong)', borderRadius: 'var(--r-input)', background: 'var(--surface)',
            }}
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'settled' | 'void')}
            style={{ height: 'var(--control-h)', padding: '0 8px', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-input)', background: 'var(--surface)' }}
          >
            <option value="settled">Settled</option>
            <option value="void">Cancelled</option>
          </select>
        </div>

        <div style={{ overflow: 'auto', display: 'grid', gap: 8, alignContent: 'start' }}>
          {shown.length === 0 ? (
            <EmptyState title={status === 'settled' ? 'No settled bills' : 'No cancelled orders'} hint="Try another day or clear the search." />
          ) : shown.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelectedId(o.id)}
              style={{
                textAlign: 'left', cursor: 'pointer', padding: 12, borderRadius: 'var(--r-card)',
                border: `1px solid ${o.id === selected?.id ? 'var(--primary)' : 'var(--border)'}`,
                borderLeftWidth: 4, borderLeftColor: typeColor[o.type],
                background: o.id === selected?.id ? 'var(--primary-subtle)' : 'var(--surface)',
                display: 'flex', justifyContent: 'space-between', gap: 12,
              }}
            >
              <span style={{ display: 'grid', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>
                  {o.invoiceNo != null ? `Invoice ${data?.settings.invoicePrefix ?? ''}${o.invoiceNo}` : `Order #${o.orderNo}`}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  #{o.orderNo} · {typeLabel[o.type]}{o.tableId ? ` · ${tableName(o.tableId)}` : ''} · {time(o.settledAt ?? o.openedAt)}
                </span>
              </span>
              <span className="money">{money(o.total)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        {!selected ? <EmptyState title="Select a bill" hint="Settled and cancelled orders appear on the left." /> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h1>
                {selected.invoiceNo != null ? `Invoice ${data?.settings.invoicePrefix ?? ''}${selected.invoiceNo}` : `Order #${selected.orderNo}`}
              </h1>
              <Pill label={typeLabel[selected.type]} tone="primary" />
              {selected.status === 'settled' ? <Pill label="Settled" tone="success" /> : <Pill label="Cancelled" tone="danger" />}
              {selected.reprintCount > 0 ? <span className="muted">Printed {selected.reprintCount + 1} times</span> : null}
            </div>
            <div className="muted" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>Order #{selected.orderNo}</span>
              {selected.tableId ? <span>Table {tableName(selected.tableId)}</span> : null}
              {selected.ticketLabel ? <span>{selected.ticketLabel}</span> : null}
              {selected.customerName && selected.customerName !== selected.ticketLabel ? <span>{selected.customerName}</span> : null}
              {selected.vehicleNo ? <span>Car {selected.vehicleNo}</span> : null}
              {selected.phoneSnapshot ? <span>{selected.phoneSnapshot}</span> : null}
              <span>Waiter {employeeName(selected.waiterId)}</span>
              <span>Opened {time(selected.openedAt)}</span>
              {selected.settledAt ? <span>Settled {time(selected.settledAt)}</span> : null}
            </div>

            {error ? <Banner tone="danger">{error}</Banner> : null}
            {notice ? <Banner tone="success">{notice}</Banner> : null}

            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                    <th style={th}>Item</th>
                    <th style={{ ...th, textAlign: 'right', width: 60 }}>Qty</th>
                    <th style={{ ...th, textAlign: 'right', width: 120 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected.status === 'void' ? selected.lines : live).map((l) => (
                    <tr key={l.id} style={{ height: 'var(--row-h)', borderTop: '1px solid var(--border)' }}>
                      <td style={td}>
                        {l.nameSnapshot}
                        {l.modifiers.length > 0 ? (
                          <div className="faint" style={{ fontSize: 13 }}>{l.modifiers.map((m) => m.name).join(' · ')}</div>
                        ) : null}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.qty}</td>
                      <td style={td} className="money">
                        {money(l.qty * (l.unitPriceSnapshot + l.modifiers.reduce((t, m) => t + m.priceDelta, 0)))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
                <span className="label">Payments</span>
                {selected.payments.length === 0 ? <span className="muted">None</span> : selected.payments.map((p, i) => (
                  <span key={i} style={{ display: 'flex', gap: 12 }}>
                    <span>{p.mode}{p.refNo ? <span className="muted"> · ref {p.refNo}</span> : null}</span>
                    <span className="money">{money(p.amount)}</span>
                  </span>
                ))}
              </div>
              <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                <Row label="Subtotal" value={money(selected.subtotal)} />
                {selected.discountAmount > 0 ? <Row label="Discount" value={`−${money(selected.discountAmount)}`} /> : null}
                <Row label={data?.settings.taxName ?? 'VAT'} value={money(selected.taxAmount)} />
                <div style={{ display: 'flex', gap: 24, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600 }}>TOTAL</span>
                  <span className="money money--total" style={{ color: 'var(--primary)' }}>
                    {data?.settings.currencyDisplay} {money(selected.total)}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {selected.status === 'settled' ? (
                <Button variant="primary" onClick={() => void reprint(selected)}>Reprint bill</Button>
              ) : (
                <span className="muted">Cancelled orders cannot be printed.</span>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 24, minWidth: 260, justifyContent: 'space-between' }}>
      <span className="muted">{label}</span>
      <span className="money">{value}</span>
    </div>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 13, fontWeight: 500, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: 'var(--text-muted)', padding: '8px 8px',
}
const td: React.CSSProperties = { padding: '8px' }
