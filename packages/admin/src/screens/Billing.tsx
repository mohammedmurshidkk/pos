import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import type { Order, OrderType } from '../api/types'
import { Banner, Button, EmptyState, Field, Modal, Pill, inputStyle } from '../components/ui'
import { useStore } from '../store'
import { Settle } from './Settle'

const typeColor: Record<OrderType, string> = {
  dine_in: 'var(--dine-in)', takeaway: 'var(--takeaway)',
  car: 'var(--car)', delivery: 'var(--delivery)',
}
const typeLabel: Record<OrderType, string> = {
  dine_in: 'Dine-in', takeaway: 'Takeaway', car: 'Car', delivery: 'Delivery',
}
const VOID_REASONS = ['Customer changed mind', 'Wrong item', 'Kitchen error', 'Walked out']

const minutes = (iso: string) =>
  `${Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))} min`

/**
 * A03 — where the cashier lives.
 *
 * This is the only place voids happen: the tablet has no void control at all,
 * which removes the order-food-then-void theft vector and keeps the accountable
 * signed-in person in the loop.
 */
export function Billing() {
  const { data, operator, counterId, money, employeeName } = useStore()
  const [orders, setOrders] = useState<Order[]>([])
  const navigate = useNavigate()
  // Coming back from taking an order at the counter: show that order.
  const cameFrom = (useLocation().state as { orderId?: string } | null)?.orderId ?? null
  const [selectedId, setSelectedId] = useState<string | null>(cameFrom)
  const [filter, setFilter] = useState<'all' | OrderType>('all')
  const [error, setError] = useState<string | null>(null)
  const [settling, setSettling] = useState(false)
  const [voiding, setVoiding] = useState<{ lineId?: string } | null>(null)
  const [voidReason, setVoidReason] = useState(VOID_REASONS[0]!)
  const [discounting, setDiscounting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const open = await api.openOrders()
      setOrders(open)
      setSelectedId((id) => (id && open.some((o) => o.id === id) ? id : open[0]?.id ?? null))
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { void refresh() }, 5000)
    return () => clearInterval(t)
  }, [refresh])

  const selected = orders.find((o) => o.id === selectedId) ?? null
  const shown = filter === 'all' ? orders : orders.filter((o) => o.type === filter)
  const live = selected?.lines.filter((l) => l.status !== 'void') ?? []

  const act = async (fn: () => Promise<unknown>) => {
    if (!operator) return setError('Sign in at the counter first.')
    try {
      await fn()
      await refresh()
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20, height: '100%', minHeight: 0 }}>
      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2>Open Orders</h2>
          <span style={{ marginLeft: 'auto' }}>
            <Button variant="primary" onClick={() => navigate('/order/new')}>+ New order</Button>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', 'dine_in', 'takeaway', 'car', 'delivery'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                height: 32, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13,
                border: `1px solid ${filter === f ? 'var(--primary)' : 'var(--border)'}`,
                background: filter === f ? 'var(--primary-subtle)' : 'var(--surface)',
                color: filter === f ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 600,
              }}
            >
              {f === 'all' ? 'All' : typeLabel[f]}
            </button>
          ))}
        </div>

        <div style={{ overflow: 'auto', display: 'grid', gap: 8, alignContent: 'start' }}>
          {shown.length === 0 ? <EmptyState title="No open orders" /> : shown.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelectedId(o.id)}
              style={{
                textAlign: 'left', cursor: 'pointer', padding: 12,
                borderRadius: 'var(--r-card)', borderLeft: `4px solid ${typeColor[o.type]}`,
                border: `1px solid ${o.id === selectedId ? 'var(--primary)' : 'var(--border)'}`,
                borderLeftWidth: 4, borderLeftColor: typeColor[o.type],
                background: o.id === selectedId ? 'var(--primary-subtle)' : 'var(--surface)',
                display: 'flex', justifyContent: 'space-between', gap: 12,
              }}
            >
              <span style={{ display: 'grid', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>
                  #{o.orderNo}{o.ticketLabel ? ` · ${o.ticketLabel}` : ''}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {typeLabel[o.type]} · {employeeName(o.waiterId)} · {minutes(o.openedAt)}
                </span>
              </span>
              <span style={{ display: 'grid', gap: 4, justifyItems: 'end' }}>
                <span className="money">{money(o.total)}</span>
                {o.status === 'billed' ? <Pill label="Bill printed" tone="info" /> : null}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        {!selected ? <EmptyState title="Select an order" hint="Open orders appear on the left." /> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h1>Order #{selected.orderNo}</h1>
              <Pill label={typeLabel[selected.type]} tone="primary" />
              {selected.invoiceNo ? <span className="muted">Invoice {selected.invoiceNo}</span> : null}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="label">Waiter</span>
                <select
                  style={inputStyle}
                  value={selected.waiterId ?? ''}
                  onChange={(e) => void act(() => api.setWaiter(selected.id, e.target.value, operator!.id))}
                >
                  <option value="" disabled>Unassigned</option>
                  {(data?.employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </span>
            </div>

            {selected.customerName || selected.phoneSnapshot || selected.vehicleNo ? (
              <div className="muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: -8 }}>
                {selected.customerName ? <span>{selected.customerName}</span> : null}
                {selected.phoneSnapshot ? <span>{selected.phoneSnapshot}</span> : null}
                {selected.vehicleNo ? <span>Car {selected.vehicleNo}</span> : null}
                {selected.type === 'delivery' && selected.addressSnapshot ? <span>{selected.addressSnapshot}</span> : null}
              </div>
            ) : null}
            {error ? <Banner tone="danger">{error}</Banner> : null}
            {selected.reprintCount > 0 ? (
              <Banner tone="warning">
                Bill printed {selected.reprintCount + 1 - 1} time(s). The next print is marked REVISED if items changed.
              </Banner>
            ) : null}

            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                    <th style={th}>Item</th>
                    <th style={{ ...th, textAlign: 'right', width: 60 }}>Qty</th>
                    <th style={{ ...th, textAlign: 'right', width: 110 }}>Amount</th>
                    <th style={{ ...th, width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {live.map((l) => (
                    <tr key={l.id} style={{ height: 'var(--row-h)', borderTop: '1px solid var(--border)' }}>
                      <td style={td}>
                        {l.nameSnapshot}
                        {l.modifiers.length > 0 ? (
                          <div className="faint" style={{ fontSize: 13 }}>
                            {l.modifiers.map((m) => m.name).join(' · ')}
                          </div>
                        ) : null}
                        {l.note ? <div className="faint" style={{ fontSize: 13 }}>{l.note}</div> : null}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.qty}</td>
                      <td style={{ ...td }} className="money">
                        {money(l.qty * (l.unitPriceSnapshot + l.modifiers.reduce((sum, m) => sum + m.priceDelta, 0)))}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Button variant="ghost" onClick={() => setVoiding({ lineId: l.id })}>Void</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'grid', gap: 6, justifyItems: 'end', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <Row label="Subtotal" value={money(selected.subtotal)} />
              {selected.discountAmount > 0 ? <Row label="Discount" value={`−${money(selected.discountAmount)}`} danger /> : null}
              <Row label={`${data?.settings.taxName ?? 'VAT'}`} value={money(selected.taxAmount)} />
              <div style={{ display: 'flex', gap: 24, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600 }}>TOTAL</span>
                <span className="money money--total" style={{ color: 'var(--primary)' }}>
                  {data?.settings.currencyDisplay} {money(selected.total)}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <Button onClick={() => navigate(`/order/${selected.id}`)}>Add items</Button>
              <Button onClick={() => setDiscounting(true)}>Discount</Button>
              <Button variant="danger" onClick={() => setVoiding({})}>Void order</Button>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
                <Button onClick={() => void act(() => api.printBill(selected.id, operator!.id, counterId!))}>
                  Print bill
                </Button>
                <Button variant="primary" onClick={() => setSettling(true)}>Settle</Button>
              </span>
            </div>
          </>
        )}
      </section>

      {settling && selected ? (
        <Settle
          order={selected}
          onClose={() => setSettling(false)}
          onSettled={() => { setSettling(false); void refresh() }}
        />
      ) : null}

      {voiding && selected ? (
        <Modal
          title={voiding.lineId ? 'Void item' : 'Cancel order'}
          subtitle="A cancellation ticket prints to the kitchen that received it."
          onClose={() => setVoiding(null)}
          width={480}
        >
          <Field label="Reason">
            <select style={inputStyle} value={voidReason} onChange={(e) => setVoidReason(e.target.value)}>
              {VOID_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Button onClick={() => setVoiding(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const v = voiding
                setVoiding(null)
                void act(() => v.lineId
                  ? api.voidLine(selected.id, v.lineId, voidReason, operator!.id)
                  : api.voidOrder(selected.id, voidReason, operator!.id))
              }}
            >
              Confirm void
            </Button>
          </div>
        </Modal>
      ) : null}

      {discounting && selected ? (
        <DiscountModal
          onClose={() => setDiscounting(false)}
          onApply={(type, value, reason) => {
            setDiscounting(false)
            void act(() => api.discount(selected.id, { type, value, reason, employeeId: operator!.id }))
          }}
        />
      ) : null}
    </div>
  )
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 24, minWidth: 260, justifyContent: 'space-between' }}>
      <span className="muted">{label}</span>
      <span className={`money${danger ? ' money--neg' : ''}`}>{value}</span>
    </div>
  )
}

const DISCOUNT_REASONS = ['Staff Meal', 'Manager Comp', 'Complaint', 'Loyalty']

function DiscountModal({ onClose, onApply }: {
  onClose: () => void
  onApply: (type: 'percent' | 'amount' | 'none', value: number, reason: string) => void
}) {
  const [type, setType] = useState<'percent' | 'amount'>('percent')
  const [value, setValue] = useState('10')
  const [reason, setReason] = useState(DISCOUNT_REASONS[0]!)
  return (
    <Modal title="Apply discount" subtitle="Recorded against you in the audit log." onClose={onClose} width={480}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Type">
          <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value as 'percent' | 'amount')}>
            <option value="percent">Percent</option>
            <option value="amount">Amount</option>
          </select>
        </Field>
        <Field label="Value">
          <input style={{ ...inputStyle, textAlign: 'right' }} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      </div>
      <Field label="Reason">
        <select style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)}>
          {DISCOUNT_REASONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <Button variant="ghost" onClick={() => onApply('none', 0, '')}>Remove discount</Button>
        <span style={{ display: 'flex', gap: 12 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onApply(type, Number(value || 0), reason)}>Apply</Button>
        </span>
      </div>
    </Modal>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 13, fontWeight: 500, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: 'var(--text-muted)', padding: '8px 8px',
}
const td: React.CSSProperties = { padding: '8px' }
