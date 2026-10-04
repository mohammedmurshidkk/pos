import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { BackupStatus } from '../api/types'
import { EmptyState } from '../components/ui'
import { useStore } from '../store'
import { ago } from './BackupSettings'

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
  const [backup, setBackup] = useState<BackupStatus | null>(null)

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
    try { setBackup(await api.backups()) } catch { /* strip just goes stale */ }
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

      <HealthStrip backup={backup} />

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

/**
 * Printers and backups at a glance. The owner looks here once a day; a red
 * item is the one thing they should act on.
 */
function HealthStrip({ backup }: { backup: BackupStatus | null }) {
  const { printers, printersChecked, jobCounts, setQueueOpen } = useStore()
  const failed = Object.values(jobCounts).reduce((a, c) => a + c.failed, 0)
  const offline = printers.filter((p) => !p.online)
  const backupBad = backup ? Boolean(backup.lastError) || backup.overdue : false

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
      <button
        onClick={() => setQueueOpen(true)}
        className="card"
        style={{
          padding: 16, display: 'grid', gap: 10, textAlign: 'left', cursor: 'pointer', color: 'inherit',
          borderLeft: `4px solid ${failed || offline.length ? 'var(--danger)' : printersChecked ? 'var(--success)' : 'var(--border)'}`,
        }}
      >
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontWeight: 600 }}>Printers</span>
          <span className="muted" style={{ fontSize: 13 }}>
            {failed
              ? <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{failed} ticket{failed === 1 ? '' : 's'} failed · open queue</span>
              : offline.length ? `${offline.length} offline` : printersChecked && printers.length ? 'All online' : ''}
          </span>
        </span>
        <span style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {printers.length === 0 ? <span className="muted">{printersChecked ? 'No printers set up' : 'Checking printers…'}</span> : printers.map((p) => {
            const c = jobCounts[p.id]
            return (
              <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: p.online ? 'var(--success)' : 'var(--danger)' }} />
                {p.name}
                <span className="muted" style={{ fontSize: 13 }}>
                  {p.online ? '' : 'offline'}
                  {c?.failed ? ` ${c.failed} failed` : ''}
                  {c?.pending ? ` ${c.pending} waiting` : ''}
                </span>
              </span>
            )
          })}
        </span>
      </button>

      <Link
        to="/settings?tab=backup"
        className="card"
        style={{
          padding: 16, display: 'grid', gap: 6, textDecoration: 'none', color: 'inherit',
          borderLeft: `4px solid ${!backup ? 'var(--border)' : backupBad ? 'var(--warning)' : 'var(--success)'}`,
        }}
      >
        <span style={{ fontWeight: 600 }}>Last backup</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: backup?.lastError ? 'var(--danger)' : undefined }}>
          {!backup ? '…' : backup.lastError ? 'Failed' : backup.lastBackupAt ? ago(backup.lastBackupAt) : 'Never'}
        </span>
        <span className="muted" style={{ fontSize: 13 }}>
          {!backup ? '' : backup.lastError ? 'Open Settings → Backup' : backup.overdue ? 'Overdue · back up now' : `${backup.count} kept · ${backup.retentionDays} days`}
        </span>
      </Link>
    </div>
  )
}
