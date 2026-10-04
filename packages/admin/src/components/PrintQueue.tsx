import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { PrintJob } from '../api/types'
import { Banner, Button, EmptyState, Modal, Pill } from './ui'
import { useStore } from '../store'

const statusTone = {
  pending: 'info', printing: 'primary', failed: 'danger', done: 'success', discarded: 'warning',
} as const
const statusLabel: Record<PrintJob['status'], string> = {
  pending: 'Waiting', printing: 'Printing', failed: 'Failed', done: 'Printed', discarded: 'Discarded',
}

const at = (iso: string) => new Date(iso).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

/**
 * The print queue, one job per row. A failed KOT is the one that matters: the
 * kitchen never saw the order. Retry sends it again once the printer is back;
 * Discard is for when the kitchen was told another way and a late copy would
 * only cause a second plate.
 */
export function PrintQueue({ onClose }: { onClose: () => void }) {
  const { operator, refreshJobs, refreshPrinters } = useStore()
  const [filter, setFilter] = useState<'problems' | 'all'>('problems')
  const [jobs, setJobs] = useState<PrintJob[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setJobs((await api.printJobs(filter)).jobs)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
    void refreshJobs()
  }, [filter, refreshJobs])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { void refresh() }, 3000)
    return () => clearInterval(t)
  }, [refresh])

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  const failed = (jobs ?? []).filter((j) => j.status === 'failed').length

  return (
    <Modal title="Print queue" subtitle="Each ticket sent to a printer. Failed ones never reached paper." onClose={onClose} width={860}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['problems', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={chip(filter === f)}>
            {f === 'problems' ? 'Needs attention' : 'Recent, all'}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button onClick={() => void refreshPrinters()}>Check printers</Button>
          <Button
            variant="primary" disabled={failed === 0 || busy !== null}
            onClick={() => void act('all', () => api.retryJobs())}
          >Retry all failed{failed ? ` (${failed})` : ''}</Button>
        </span>
      </div>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {jobs === null ? <EmptyState title="Loading…" /> : jobs.length === 0 ? (
        <EmptyState
          title={filter === 'problems' ? 'Nothing waiting' : 'No print jobs yet'}
          hint={filter === 'problems' ? 'Every ticket has printed.' : undefined}
        />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {jobs.map((j) => (
            <div
              key={j.id}
              style={{
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center',
                padding: 12, borderRadius: 'var(--r-card)', border: '1px solid var(--border)',
                borderLeft: `4px solid ${j.status === 'failed' ? 'var(--danger)' : 'var(--border)'}`,
              }}
            >
              <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Pill label={statusLabel[j.status]} tone={statusTone[j.status]} />
                  <span style={{ fontWeight: 600 }}>{j.kindLabel}</span>
                  {j.detail ? <span>{j.detail}</span> : null}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {j.printerName} · {at(j.createdAt)}
                  {j.attempts ? ` · ${j.attempts} attempt${j.attempts === 1 ? '' : 's'}` : ''}
                </div>
                {j.lastError && j.status !== 'done' ? (
                  <div style={{ fontSize: 13, color: 'var(--danger)', overflowWrap: 'anywhere' }}>{j.lastError}</div>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {j.status === 'failed' || j.status === 'discarded' ? (
                  <Button disabled={busy !== null} onClick={() => void act(j.id, () => api.retryJob(j.id, operator!.id))}>
                    {j.status === 'discarded' ? 'Print again' : 'Retry'}
                  </Button>
                ) : null}
                {j.status === 'failed' || j.status === 'pending' ? (
                  <Button variant="danger" disabled={busy !== null} onClick={() => void act(j.id, () => api.discardJob(j.id, operator!.id))}>
                    Discard
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

const chip = (active: boolean): React.CSSProperties => ({
  height: 32, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600,
  border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
  background: active ? 'var(--primary-subtle)' : 'var(--surface)',
  color: active ? 'var(--primary)' : 'var(--text-muted)',
})
