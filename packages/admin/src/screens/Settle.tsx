import { useMemo, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { Order } from '../api/types'
import { useStore } from '../store'
import { Banner, Button, Field, Modal, inputStyle } from '../components/ui'

interface Tender { paymentModeId: string; amount: number; refNo?: string | null }

/**
 * A04 — settlement.
 *
 * Payments are a child table on the hub, so part-cash part-card is one order
 * with two rows, and day-wise merchant totals fall out of a GROUP BY.
 */
export function Settle({ order, onClose, onSettled }: {
  order: Order
  onClose: () => void
  onSettled: () => void
}) {
  const { data, operator, counterId, money } = useStore()
  const modes = data?.paymentModes ?? []

  const [modeId, setModeId] = useState(modes[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [refNo, setRefNo] = useState('')
  const [tenders, setTenders] = useState<Tender[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const mode = modes.find((m) => m.id === modeId)
  const decimals = data?.settings.currencyDecimals ?? 2
  const toMinor = (v: string) => Math.round(Number(v || 0) * 10 ** decimals)

  const taken = useMemo(() => tenders.reduce((a, t) => a + t.amount, 0), [tenders])
  const due = Math.max(0, order.total - taken)
  const change = Math.max(0, taken - order.total)

  const addTender = () => {
    const minor = toMinor(amount)
    if (minor <= 0) return setError('Enter an amount.')
    if (mode?.requiresRef && !refNo.trim()) return setError(`${mode.name} needs an approval or reference number.`)
    setTenders([...tenders, { paymentModeId: modeId, amount: minor, refNo: refNo.trim() || null }])
    setAmount('')
    setRefNo('')
    setError(null)
  }

  const settle = async () => {
    if (!operator || !counterId) return setError('Sign in at the counter first.')
    setBusy(true)
    setError(null)
    try {
      await api.settle(order.id, { payments: tenders, employeeId: operator.id, counterId })
      onSettled()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Settle Order #${order.orderNo}`} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="label">Total due</span>
        <span className="money money--total" style={{ color: 'var(--primary)' }}>
          {data?.settings.currencyDisplay} {money(order.total)}
        </span>
      </div>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(modes.length, 4)}, 1fr)`, gap: 12 }}>
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setModeId(m.id)}
            style={{
              minHeight: 56, borderRadius: 'var(--r-button)', cursor: 'pointer',
              border: `1px solid ${m.id === modeId ? 'var(--primary)' : 'var(--border-strong)'}`,
              background: m.id === modeId ? 'var(--primary-subtle)' : 'var(--surface)',
              fontWeight: 600, display: 'grid', placeItems: 'center', gap: 2,
            }}
          >
            <span>{m.name}</span>
            {m.merchantName ? <span className="faint" style={{ fontSize: 12 }}>{m.merchantName}</span> : null}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: mode?.requiresRef ? '1fr 1fr' : '1fr', gap: 12 }}>
        <Field label="Amount">
          <input
            style={{ ...inputStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
            value={amount}
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)}
            placeholder={(due / 10 ** decimals).toFixed(decimals)}
          />
        </Field>
        {mode?.requiresRef ? (
          <Field label="Approval / ref no">
            <input style={inputStyle} value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="Last 4 digits" />
          </Field>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={() => setAmount((due / 10 ** decimals).toFixed(decimals))}>Exact</Button>
        {[50, 100, 200, 500].map((v) => (
          <Button key={v} onClick={() => setAmount(String(v))}>{v}</Button>
        ))}
        <Button variant="primary" onClick={addTender} style={{ marginLeft: 'auto' }}>Add payment</Button>
      </div>

      {tenders.length > 0 ? (
        <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
          {tenders.map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                {modes.find((m) => m.id === t.paymentModeId)?.name}
                {t.refNo ? <span className="faint"> · {t.refNo}</span> : null}
              </span>
              <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className="money">{money(t.amount)}</span>
                <Button variant="ghost" onClick={() => setTenders(tenders.filter((_, j) => j !== i))}>Remove</Button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
        <span>{change > 0 ? 'Change' : 'Balance due'}</span>
        <span className="money" style={{ color: due === 0 ? 'var(--success)' : 'var(--text)' }}>
          {money(change > 0 ? change : due)}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || taken < order.total} onClick={() => void settle()}>
          {busy ? 'Settling…' : 'Settle & print invoice'}
        </Button>
      </div>
    </Modal>
  )
}
