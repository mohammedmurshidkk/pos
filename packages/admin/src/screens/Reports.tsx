import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { RangePreset } from '../api/types'
import { Banner, EmptyState } from '../components/ui'
import { RangePicker, rangeQuery } from '../components/RangePicker'
import { useStore } from '../store'

type Kind = 'summary' | 'items' | 'categories' | 'employees' | 'payment-modes' | 'order-types' | 'discounts-voids' | 'tax'

const TABS: { kind: Kind; label: string }[] = [
  { kind: 'summary', label: 'Summary' },
  { kind: 'items', label: 'Items' },
  { kind: 'categories', label: 'Categories' },
  { kind: 'employees', label: 'Staff' },
  { kind: 'payment-modes', label: 'Payments' },
  { kind: 'order-types', label: 'Order types' },
  { kind: 'discounts-voids', label: 'Discounts & voids' },
  { kind: 'tax', label: 'Tax' },
]

/** How a column is shown. `money` columns are right-aligned and totalled. */
interface Col { key: string; label: string; money?: boolean; num?: boolean; fmt?: (v: unknown, row: Record<string, unknown>) => string }

const typeLabel: Record<string, string> = { dine_in: 'Dine-in', takeaway: 'Takeaway', car: 'Car', delivery: 'Delivery' }
const when = (v: unknown) => (v ? new Date(v as string).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
}) : '')

const COLUMNS: Partial<Record<Kind, Col[]>> = {
  items: [{ key: 'name', label: 'Item' }, { key: 'qty', label: 'Qty', num: true }, { key: 'gross', label: 'Sales', money: true }],
  categories: [{ key: 'name', label: 'Category' }, { key: 'qty', label: 'Qty', num: true }, { key: 'gross', label: 'Sales', money: true }],
  employees: [
    { key: 'name', label: 'Staff' }, { key: 'orders', label: 'Orders', num: true },
    { key: 'total', label: 'Sales', money: true }, { key: 'averageTicket', label: 'Avg ticket', money: true },
  ],
  'payment-modes': [
    { key: 'name', label: 'Payment' }, { key: 'merchant', label: 'Merchant' },
    { key: 'count', label: 'Payments', num: true }, { key: 'total', label: 'Amount', money: true },
  ],
  'order-types': [
    { key: 'type', label: 'Order type', fmt: (v) => typeLabel[v as string] ?? String(v) },
    { key: 'count', label: 'Orders', num: true }, { key: 'total', label: 'Sales', money: true },
  ],
}

/** Averages are not summed: a total of averages means nothing. */
const NO_TOTAL = new Set(['averageTicket'])

/**
 * A18 — reports on the counter PC. Every report the hub can produce, over any
 * day or period, with the same numbers as the CSV an accountant gets.
 * Revenue is counted when a bill is settled, so open bills never appear.
 */
export function Reports() {
  const { money, data } = useStore()
  const [kind, setKind] = useState<Kind>('summary')
  const [preset, setPreset] = useState<RangePreset>('today')
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10))
  const [result, setResult] = useState<{ kind: Kind; label: string; data: unknown } | null>(null)
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const range = rangeQuery(preset, day)

  const refresh = useCallback(async () => {
    try {
      const res = await api.reportRange<unknown>(kind, rangeQuery(preset, day))
      setResult({ kind, label: res.range.label, data: res.data })
      setGeneratedAt(new Date())
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [kind, preset, day])

  useEffect(() => { void refresh() }, [refresh])

  const cur = data?.settings.currencyDisplay ?? ''
  const ready = result && result.kind === kind

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1>Reports</h1>
        <span className="muted">{ready ? result.label : ''}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          {generatedAt ? (
            <span className="faint" style={{ fontSize: 13 }}>
              As of {generatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
          <button onClick={() => void refresh()} style={linkBtn}>Refresh</button>
          <a href={api.reportCsvUrl(kind, range)} download style={{ ...linkBtn, ...primaryLink }}>Download CSV</a>
        </span>
      </div>

      <RangePicker preset={preset} day={day} onPreset={setPreset} onDay={setDay} />

      <div role="tablist" style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.kind} role="tab" aria-selected={t.kind === kind} onClick={() => setKind(t.kind)}
            style={{
              padding: '10px 14px', cursor: 'pointer', background: 'transparent', border: 'none', fontWeight: 600,
              borderBottom: `2px solid ${t.kind === kind ? 'var(--primary)' : 'transparent'}`,
              color: t.kind === kind ? 'var(--primary)' : 'var(--text-muted)', marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {!ready ? <EmptyState title="Loading…" /> : kind === 'summary' ? (
          <SummaryView d={result.data as Summary} money={money} cur={cur} taxName={data?.settings.taxName ?? 'VAT'} />
        ) : kind === 'tax' ? (
          <TaxView d={result.data as Tax} money={money} cur={cur} />
        ) : kind === 'discounts-voids' ? (
          <DiscountsVoids d={result.data as DV} money={money} />
        ) : (
          <Table cols={COLUMNS[kind]!} rows={result.data as Record<string, unknown>[]} money={money} />
        )}
      </div>
    </div>
  )
}

interface Summary {
  orders: number; grossSales: number; discounts: number; serviceCharge: number
  net: number; tax: number; total: number; averageTicket: number
}
interface Tax {
  taxName: string; taxRatePct: number; taxNumberLabel: string; taxNumberValue: string
  invoices: number; invoiceFrom: string | null; invoiceTo: string | null; net: number; tax: number; total: number
}
interface DV {
  discounts: { orderNo: number; invoiceNo: string | null; amount: number; type: string | null; value: number | null; reason: string | null; by: string | null; at: string }[]
  voids: { orderNo: number | null; name: string; qty: number; amount: number; reason: string | null; by: string | null; at: string }[]
  totals: { discountCount: number; discountTotal: number; voidCount: number; voidTotal: number }
}

type Money = (minor: number) => string

function Table({ cols, rows, money, empty = 'Nothing in this period', hint = 'Only settled bills count.' }: {
  cols: Col[]; rows: Record<string, unknown>[]; money: Money; empty?: string; hint?: string
}) {
  if (rows.length === 0) return <section className="card"><EmptyState title={empty} hint={hint} /></section>
  const right = (c: Col) => c.money || c.num
  return (
    <section className="card">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
            {cols.map((c) => <th key={c.key} style={{ ...th, textAlign: right(c) ? 'right' : 'left' }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ height: 'var(--row-h)', borderTop: '1px solid var(--border)' }}>
              {cols.map((c) => {
                const v = r[c.key]
                return (
                  <td key={c.key} style={{ ...td, textAlign: right(c) ? 'right' : 'left' }} className={c.money ? 'money' : undefined}>
                    {c.money ? money(Number(v ?? 0)) : c.fmt ? c.fmt(v, r) : String(v ?? '')}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border-strong)', fontWeight: 700 }}>
            {cols.map((c, i) => (
              <td key={c.key} style={{ ...td, textAlign: right(c) ? 'right' : 'left' }} className={c.money ? 'money' : undefined}>
                {i === 0 ? `Total (${rows.length})`
                  : NO_TOTAL.has(c.key) ? ''
                  : c.money ? money(rows.reduce((a, r) => a + Number(r[c.key] ?? 0), 0))
                  : c.num ? String(rows.reduce((a, r) => a + Number(r[c.key] ?? 0), 0))
                  : ''}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </section>
  )
}

function SummaryView({ d, money, cur, taxName }: { d: Summary; money: Money; cur: string; taxName: string }) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <Stat label="Sales" value={`${cur} ${money(d.total)}`} sub={`${d.orders} bills`} />
        <Stat label="Average bill" value={`${cur} ${money(d.averageTicket)}`} />
        <Stat label={`${taxName} collected`} value={`${cur} ${money(d.tax)}`} />
        <Stat label="Discounts" value={`${cur} ${money(d.discounts)}`} />
      </div>
      {/* The lines reconcile: gross − discounts + service = total = net + tax. */}
      <section className="card" style={{ padding: 20, display: 'grid', gap: 8, maxWidth: 520 }}>
        <h2>How the total adds up</h2>
        <KV k="Gross sales" v={money(d.grossSales)} />
        <KV k="Discounts" v={`− ${money(d.discounts)}`} />
        {d.serviceCharge ? <KV k="Service charge" v={`+ ${money(d.serviceCharge)}`} /> : null}
        <KV k="Total collected" v={money(d.total)} strong />
        <div style={{ height: 8 }} />
        <KV k="Net of tax" v={money(d.net)} />
        <KV k={taxName} v={money(d.tax)} />
      </section>
    </div>
  )
}

function TaxView({ d, money, cur }: { d: Tax; money: Money; cur: string }) {
  return (
    <section className="card" style={{ padding: 20, display: 'grid', gap: 8, maxWidth: 520 }}>
      <h2>{d.taxName} at {d.taxRatePct}%</h2>
      {d.taxNumberValue ? <KV k={d.taxNumberLabel} v={d.taxNumberValue} /> : null}
      <KV k="Invoices" v={d.invoices ? `${d.invoices} (${d.invoiceFrom} – ${d.invoiceTo})` : 'none'} />
      <KV k="Taxable amount" v={`${cur} ${money(d.net)}`} />
      <KV k={d.taxName} v={`${cur} ${money(d.tax)}`} />
      <KV k="Total" v={`${cur} ${money(d.total)}`} strong />
    </section>
  )
}

function DiscountsVoids({ d, money }: { d: DV; money: Money }) {
  // Stored as a number; printed with the prefix, as on the bill.
  const prefix = useStore((st) => st.data?.settings.invoicePrefix ?? '')
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h2>Discounts · {d.totals.discountCount} · {money(d.totals.discountTotal)}</h2>
      <Table
        money={money} rows={d.discounts} empty="No discounts in this period"
        cols={[
          { key: 'at', label: 'When', fmt: when }, { key: 'invoiceNo', label: 'Invoice', fmt: (v) => v == null ? '' : `${prefix}${v}` },
          { key: 'orderNo', label: 'Order', fmt: (v) => `#${v}` },
          { key: 'value', label: 'Discount', fmt: (v, r) => v == null ? '' : r.type === 'percent' ? `${v}%` : money(Number(v)) },
          { key: 'reason', label: 'Reason', fmt: (v) => String(v ?? '') }, { key: 'by', label: 'By', fmt: (v) => String(v ?? '') },
          { key: 'amount', label: 'Amount', money: true },
        ]}
      />
      <h2>Voids · {d.totals.voidCount} · {money(d.totals.voidTotal)}</h2>
      <Table
        money={money} rows={d.voids} empty="No voids in this period" hint="Items cancelled after the kitchen got them."
        cols={[
          { key: 'at', label: 'When', fmt: when }, { key: 'orderNo', label: 'Order', fmt: (v) => v == null ? '' : `#${v}` },
          { key: 'name', label: 'Item' }, { key: 'qty', label: 'Qty', num: true },
          { key: 'reason', label: 'Reason', fmt: (v) => String(v ?? '') }, { key: 'by', label: 'By', fmt: (v) => String(v ?? '') },
          { key: 'amount', label: 'Amount', money: true },
        ]}
      />
    </div>
  )
}

function KV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: strong ? 700 : 400 }}>
      <span className={strong ? undefined : 'muted'}>{k}</span><span className="money">{v}</span>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: 20, display: 'grid', gap: 6 }}>
      <span className="muted" style={{ fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 700 }}>{value}</span>
      {sub ? <span className="faint" style={{ fontSize: 13 }}>{sub}</span> : null}
    </div>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 13, fontWeight: 500, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: 'var(--text-muted)', padding: '10px 12px',
}
const td: React.CSSProperties = { padding: '8px 12px' }
const linkBtn: React.CSSProperties = {
  height: 36, padding: '0 14px', borderRadius: 'var(--r-button)', border: '1px solid var(--border-strong)',
  background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', textDecoration: 'none', fontSize: 14,
}
const primaryLink: React.CSSProperties = { background: 'var(--primary)', color: 'var(--on-primary)', borderColor: 'var(--primary)' }
