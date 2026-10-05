import { useMemo, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { Order } from '../api/types'
import { useStore } from '../store'
import { Banner, Button, Field, Modal, inputStyle } from '../components/ui'
import { CustomerFields } from '../components/CustomerFields'

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
  // Asked at the till for every order type. Optional: a customer who would
  // rather not say still gets served. Saved by phone for CRM later.
  const [phone, setPhone] = useState(order.phoneSnapshot ?? '')
  const [name, setName] = useState(order.customerName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const mode = modes.find((m) => m.id === modeId)
  const decimals = data?.settings.currencyDecimals ?? 2
  const toMinor = (v: string) => Math.round(Number(v || 0) * 10 ** decimals)

  const added = useMemo(() => tenders.reduce((a, t) => a + t.amount, 0), [tenders])
  const remaining = Math.max(0, order.total - added)

  // What is on screen counts without an "Add payment" tap. "+ Split" is only
  // for part-cash part-card. Cash needs an amount typed or a chip tapped
  // (Exact, 50, 100…): settling cash nobody entered records money the drawer
  // may not hold. Card and other modes charge the exact rest, so an empty
  // amount there still means "the rest of it".
  const isCash = mode?.type === 'cash'
  const typed = amount.trim() === '' ? (isCash ? 0 : remaining) : toMinor(amount)
  const pending: Tender | null = typed > 0
    ? { paymentModeId: modeId, amount: typed, refNo: refNo.trim() || null }
    : null
  const all = pending ? [...tenders, pending] : tenders
  const taken = all.reduce((a, t) => a + t.amount, 0)
  const due = Math.max(0, order.total - taken)
  const change = Math.max(0, taken - order.total)
  const needsRef = pending != null && mode?.requiresRef && !refNo.trim()
  const needsCash = isCash && amount.trim() === '' && taken < order.total

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
    if (needsRef) return setError(`${mode?.name} needs an approval or reference number.`)
    if (needsCash) return setError('Enter the cash received, or tap Exact.')
    setBusy(true)
    setError(null)
    try {
      const customer = phone.trim() || name.trim() ? { phone: phone.trim() || null, name: name.trim() || null } : null
      await api.settle(order.id, { payments: all, employeeId: operator.id, counterId, customer })
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

      <CustomerFields row phone={phone} name={name} onPhone={setPhone} onName={setName} />

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
            placeholder={isCash ? 'Cash received' : (remaining / 10 ** decimals).toFixed(decimals)}
          />
        </Field>
        {mode?.requiresRef ? (
          <Field label="Approval / ref no">
            <input style={inputStyle} value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="Last 4 digits" />
          </Field>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={() => setAmount((remaining / 10 ** decimals).toFixed(decimals))}>Exact</Button>
        {[50, 100, 200, 500].map((v) => (
          <Button key={v} onClick={() => setAmount(String(v))}>{v}</Button>
        ))}
        <Button variant="ghost" onClick={addTender} style={{ marginLeft: 'auto' }}>+ Split payment</Button>
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

      {needsCash && remaining > 0 ? (
        <span className="muted" style={{ textAlign: 'right' }}>Enter the cash received, or tap Exact.</span>
      ) : null}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || taken < order.total || needsRef} onClick={() => void settle()}>
          {/* The printed bill is the tax invoice. Settling prints only if the
              customer has no bill yet, or theirs is out of date. */}
          {busy ? 'Settling…'
            : order.invoiceNo == null ? 'Settle & print bill'
            : order.dirtySincePrint ? 'Settle & print revised bill'
            : 'Settle'}
        </Button>
      </div>
    </Modal>
  )
}
