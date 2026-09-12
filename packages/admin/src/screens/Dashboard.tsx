import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { EmptyState } from '../components/ui'
import { useStore } from '../store'

interface Summary {
  orders: number; grossSales: number; discounts: number
  net: number; tax: number; total: number; averageTicket: number
}
interface TypeRow { type: string; count: number; total: number }

const typeColor: Record<string, string> = {
  dine_in: 'var(--dine-in)', takeaway: 'var(--takeaway)',
  car: 'var(--car)', delivery: 'var(--delivery)',
}

/** A02 — the owner's five-second answer to "how are we doing today?" */
export function Dashboard() {
  const { data, money } = useStore()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [types, setTypes] = useState<TypeRow[]>([])
  const [label, setLabel] = useState('Today')

  const refresh = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        api.report<Summary>('summary'),
        api.report<TypeRow[]>('order-types'),
      ])
      setSummary(s.data)
      setTypes(t.data)
      setLabel(s.range.label)
    } catch { /* the shell shows the connection error */ }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { void refresh() }, 15_000)
    return () => clearInterval(t)
  }, [refresh])

  if (!summary) return <EmptyState title="Loading…" />

  const max = Math.max(1, ...types.map((t) => t.total))
  const cur = data?.settings.currencyDisplay ?? ''

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <h1>{label}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <Stat label="Sales" value={`${cur} ${money(summary.total)}`} sub={`${summary.orders} invoices`} />
        <Stat label="Average ticket" value={`${cur} ${money(summary.averageTicket)}`} />
        <Stat label={`${data?.settings.taxName ?? 'VAT'} collected`} value={`${cur} ${money(summary.tax)}`} />
        <Stat label="Discounts" value={`${cur} ${money(summary.discounts)}`} tone={summary.discounts > 0 ? 'var(--warning)' : undefined} />
      </div>

      <div className="card" style={{ padding: 20, display: 'grid', gap: 12 }}>
        <h2>Sales by order type</h2>
        {types.length === 0 ? <EmptyState title="No sales yet today" /> : types.map((t) => (
          <div key={t.type} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">{t.type.replace('_', '-')} ({t.count})</span>
              <span className="money">{money(t.total)}</span>
            </div>
            <div style={{ height: 8, background: 'var(--surface-alt)', borderRadius: 4 }}>
              <div style={{
                width: `${(t.total / max) * 100}%`, height: '100%', borderRadius: 4,
                background: typeColor[t.type] ?? 'var(--primary)',
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card" style={{ padding: 20, display: 'grid', gap: 4 }}>
      <span className="label">{label}</span>
      <span className="money" style={{ fontSize: 26, textAlign: 'left', color: tone }}>{value}</span>
      {sub ? <span className="faint" style={{ fontSize: 13 }}>{sub}</span> : null}
    </div>
  )
}
