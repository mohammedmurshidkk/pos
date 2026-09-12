import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { PrintJob, Printer } from '../api/types'
import { Banner, Button, EmptyState, Pill } from '../components/ui'

/**
 * A10 — support-critical. Your colleague diagnoses a dead kitchen printer from
 * this screen over the phone, so status and Test Print sit on every row.
 */
export function Printers() {
  const [printers, setPrinters] = useState<Printer[]>([])
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [p, j] = await Promise.all([api.printers(), api.printJobs()])
      setPrinters(p)
      setJobs(j)
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { void refresh() }, 10_000)
    return () => clearInterval(t)
  }, [refresh])

  const pendingFor = (id: string) => jobs.filter((j) => j.printerId === id && j.status === 'pending').length
  const failedFor = (id: string) => jobs.filter((j) => j.printerId === id && j.status === 'failed').length
  const offline = printers.filter((p) => !p.online)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1>Printers</h1>

      {note ? <Banner tone="info">{note}</Banner> : null}

      {offline.length > 0 ? (
        <Banner tone="danger">
          <span style={{ flex: 1 }}>
            {offline.map((p) => p.name).join(', ')} unreachable
            {jobs.some((j) => j.status === 'failed') ? ' — tickets are queued.' : '.'}
          </span>
          <Button variant="secondary" onClick={async () => {
            const { retried } = await api.retryJobs()
            setNote(`${retried} job(s) requeued.`)
            await refresh()
          }}>Retry all</Button>
        </Banner>
      ) : null}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Name', 'Address', 'Paper', 'Status', 'Queued', ''].map((h, i) => (
                <th key={h || i} style={{
                  textAlign: i > 1 && i < 5 ? 'center' : 'left',
                  fontSize: 13, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase',
                  color: 'var(--text-muted)', padding: 12, borderBottom: '1px solid var(--border)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {printers.length === 0 ? (
              <tr><td colSpan={6}><EmptyState title="No printers configured" /></td></tr>
            ) : printers.map((p) => {
              const failed = failedFor(p.id)
              return (
                <tr key={p.id} style={{
                  height: 'var(--row-h)', borderTop: '1px solid var(--border)',
                  background: p.online ? undefined : 'color-mix(in srgb, var(--danger) 5%, transparent)',
                }}>
                  <td style={{ padding: 12, fontWeight: 600 }}>{p.name}</td>
                  <td style={{ padding: 12, fontFamily: 'ui-monospace, monospace' }} className="muted">
                    {p.ip}:{p.port}
                  </td>
                  <td style={{ padding: 12, textAlign: 'center' }} className="muted">{p.width}mm</td>
                  <td style={{ padding: 12, textAlign: 'center' }}>
                    <Pill label={p.online ? 'Online' : 'Offline'} tone={p.online ? 'success' : 'danger'} />
                  </td>
                  <td style={{ padding: 12, textAlign: 'center' }}>
                    {failed > 0
                      ? <Pill label={`${failed} failed`} tone="danger" />
                      : <span className={pendingFor(p.id) ? '' : 'faint'}>{pendingFor(p.id)}</span>}
                  </td>
                  <td style={{ padding: 12, textAlign: 'right' }}>
                    <Button onClick={async () => {
                      await api.testPrint(p.id)
                      setNote(`Test print queued for ${p.name}.`)
                      await refresh()
                    }}>Test print</Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h2>Recent print jobs</h2>
      <div className="card" style={{ padding: 12, display: 'grid', gap: 6, maxHeight: 260, overflow: 'auto' }}>
        {jobs.length === 0 ? <EmptyState title="Nothing printed yet" /> : jobs.slice(-25).reverse().map((j) => (
          <div key={j.id} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 14 }}>
            <span style={{ width: 70, fontWeight: 600 }}>{j.kind}</span>
            <span className="muted" style={{ width: 160 }}>
              {printers.find((p) => p.id === j.printerId)?.name ?? j.printerId.slice(0, 8)}
            </span>
            <Pill
              label={j.status}
              tone={j.status === 'done' ? 'success' : j.status === 'failed' ? 'danger' : 'warning'}
            />
            {j.lastError ? <span className="faint" style={{ flex: 1 }}>{j.lastError}</span> : null}
          </div>
        ))}
      </div>
    </div>
  )
}
