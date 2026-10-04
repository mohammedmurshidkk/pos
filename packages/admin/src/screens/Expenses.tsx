import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { Expense, ExpenseCategory, RangePreset } from '../api/types'
import { Banner, Button, EmptyState, Field, Modal, Pill, inputStyle } from '../components/ui'
import { RangePicker, rangeQuery } from '../components/RangePicker'
import { useStore } from '../store'

/**
 * A16 — money paid out: gas, ice, a plumber, a staff advance.
 *
 * Recording a drawer payout here is what keeps the Z-report honest. Cash that
 * leaves the drawer without an entry shows up at close as a shortage that
 * nobody can explain.
 */
export function Expenses() {
  const { money } = useStore()
  const [preset, setPreset] = useState<RangePreset>('today')
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10))
  const [categoryId, setCategoryId] = useState('')
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [rows, setRows] = useState<Expense[]>([])
  const [label, setLabel] = useState('Today')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [res, cats] = await Promise.all([
        api.expenses(rangeQuery(preset, day), categoryId || undefined),
        api.expenseCategories(),
      ])
      setRows(res.expenses)
      setLabel(res.range.label)
      setCategories(cats)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [preset, day, categoryId])

  useEffect(() => { void refresh() }, [refresh])

  const total = rows.reduce((t, r) => t + r.amount, 0)
  const fromDrawer = rows.filter((r) => r.paidFromDrawer).reduce((t, r) => t + r.amount, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1>Expenses</h1>
        <span className="muted">{label}</span>
        <span style={{ marginLeft: 'auto' }}>
          <Button variant="primary" onClick={() => setAdding(true)}>+ Add expense</Button>
        </span>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <RangePicker preset={preset} day={day} onPreset={setPreset} onDay={setDay} />
        <select style={{ ...inputStyle, marginLeft: 'auto' }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      <section className="card" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {rows.length === 0 ? (
          <EmptyState title="No expenses recorded" hint="Anything paid out of the drawer belongs here, or it shows as a shortage at close." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                <th style={th}>When</th>
                <th style={th}>Category</th>
                <th style={th}>Note</th>
                <th style={th}>Paid by</th>
                <th style={th}>Source</th>
                <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ height: 'var(--row-h)', borderTop: '1px solid var(--border)' }}>
                  <td style={td}>{new Date(r.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td style={td}>{r.category}</td>
                  <td style={td} className="muted">{r.note ?? ''}</td>
                  <td style={td}>{r.paidBy}</td>
                  <td style={td}>{r.paidFromDrawer ? <Pill label="Drawer" tone="warning" /> : <Pill label="Other" tone="info" />}</td>
                  <td style={td} className="money">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="card" style={{ padding: 16, display: 'flex', gap: 32, justifyContent: 'flex-end' }}>
        <span><span className="muted">From drawer </span><span className="money">{money(fromDrawer)}</span></span>
        <span><span className="muted">Total </span><span className="money" style={{ fontWeight: 600 }}>{money(total)}</span></span>
      </div>

      {adding ? (
        <ExpenseModal
          categories={categories.filter((c) => c.active)}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void refresh() }}
        />
      ) : null}
    </div>
  )
}

/**
 * Add an expense. Also opened from Shift as "Pay out", since mid-shift is when
 * payouts actually happen.
 *
 * "Paid from drawer" is on whenever a shift is open: that is the case the
 * Z-report depends on. With no open shift there is no drawer, and the hub
 * records it as paid from elsewhere whatever the client sends.
 */
export function ExpenseModal({ categories, onClose, onSaved }: {
  categories?: ExpenseCategory[]
  onClose: () => void
  onSaved: () => void
}) {
  const { data, operator, counterId, money } = useStore()
  const [cats, setCats] = useState<ExpenseCategory[]>(categories ?? [])
  const [categoryId, setCategoryId] = useState(categories?.[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null)
  const [fromDrawer, setFromDrawer] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decimals = data?.settings.currencyDecimals ?? 2
  const minor = Math.round(Number(amount || 0) * 10 ** decimals)
  const valid = categoryId !== '' && Number.isFinite(minor) && minor > 0

  useEffect(() => {
    if (!categories) {
      api.expenseCategories()
        .then((all) => {
          const active = all.filter((c) => c.active)
          setCats(active)
          setCategoryId((id) => id || active[0]?.id || '')
        })
        .catch(() => setError('Could not load expense categories.'))
    }
    if (counterId) {
      api.currentShift(counterId)
        .then((s) => { setShiftOpen(s.open); if (!s.open) setFromDrawer(false) })
        .catch(() => setShiftOpen(false))
    } else {
      setShiftOpen(false)
      setFromDrawer(false)
    }
  }, [categories, counterId])

  const save = async () => {
    if (!operator) return setError('Sign in at the counter first.')
    setBusy(true)
    try {
      await api.createExpense({
        expenseCategoryId: categoryId, amount: minor, note: note.trim() || null,
        paidBy: operator.id, counterId, paidFromDrawer: fromDrawer,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Add expense" subtitle={`Recorded against ${operator?.name ?? 'you'}.`} onClose={onClose} width={480}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {cats.length === 0 ? (
        <Banner tone="warning">No expense categories yet. Add them under Setup → Expense categories.</Banner>
      ) : null}
      <Field label="Category">
        <select style={inputStyle} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label={`Amount (${data?.settings.currencyDisplay ?? ''})`}>
        <input
          autoFocus
          style={{ ...inputStyle, textAlign: 'right', fontSize: 20, height: 52 }}
          inputMode="decimal"
          value={amount}
          placeholder={(0).toFixed(decimals)}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        />
      </Field>
      <Field label="Note">
        <input style={inputStyle} value={note} maxLength={120} placeholder="Gas cylinder, ice, plumber…" onChange={(e) => setNote(e.target.value)} />
      </Field>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', opacity: shiftOpen ? 1 : 0.6 }}>
        <input
          type="checkbox"
          checked={fromDrawer}
          disabled={!shiftOpen}
          onChange={(e) => setFromDrawer(e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        <span>
          Paid from the cash drawer
          <div className="muted" style={{ fontSize: 13 }}>
            {shiftOpen == null ? 'Checking the shift…'
              : shiftOpen ? `Reduces expected cash at close by ${valid ? money(minor) : 'this amount'}.`
              : 'No shift is open on this counter, so it is not taken from a drawer.'}
          </div>
        </span>
      </label>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!valid || busy} onClick={() => void save()}>Save expense</Button>
      </div>
    </Modal>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 13, fontWeight: 500, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: 'var(--text-muted)', padding: '10px 12px',
}
const td: React.CSSProperties = { padding: '8px 12px' }
