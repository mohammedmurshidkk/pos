import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { LicenceStatus } from '../api/types'
import { Banner, Button, Pill } from '../components/ui'
import { timeLeft } from '../licence'
import { useStore } from '../store'

const dateOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

/**
 * Licence and trial.
 *
 * The install id is what a licence is signed against; the shop reads it off this
 * screen to the supplier, who sends back a key to paste below. Expiry stops new
 * orders and new shifts only — open tables can still be billed and the shift
 * closed, so an expiry never strands a restaurant mid-service.
 */
export function Licence() {
  const { operator, load } = useStore()
  const [status, setStatus] = useState<LicenceStatus | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.licence())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  if (!status) return <div className="muted">Loading…</div>

  const blocked = status.state === 'expired' || status.state === 'unlicensed'
  const tone = blocked ? 'danger' : status.warning ? 'warning' : status.state === 'active' ? 'success' : 'info'
  const headline =
    status.state === 'unlicensed'
      ? 'Not licensed yet'
      : status.state === 'expired'
      ? (status.plan === 'trial' ? 'The free trial has ended' : 'The licence has expired')
      : status.state === 'active'
        ? `Licensed${status.customer ? ` to ${status.customer}` : ''}`
        : 'Free trial'

  const activate = async () => {
    if (!operator) return setError('Sign in at the counter first.')
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = await api.installLicence(key, operator.id)
      setStatus(next)
      setKey('')
      setNotice(`Licence activated — valid until ${dateOf(next.expiresAt)}.`)
      await load() // clears the header banner
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(status.installId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy — select the install ID and copy it by hand.')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <h1>Licence</h1>

      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {status.clockRolledBack ? (
        <Banner tone="warning">
          This PC&apos;s clock is behind a time it has already reached. Set the correct date and time in Windows —
          changing the clock does not extend the licence.
        </Banner>
      ) : null}

      <div className="card" style={{ padding: 24, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 22 }}>{headline}</h2>
          <Pill label={{ unlicensed: 'Not licensed', active: 'Active', expired: 'Expired', trial: 'Trial' }[status.state]} tone={tone} />
        </div>
        <div className="muted">
          {status.state === 'unlicensed'
            ? 'No trial has been started and no licence key is active, so new orders and new shifts are blocked. Activate a key below, or ask your supplier to start a trial.'
            : status.state === 'expired'
            ? `Ended ${dateOf(status.expiresAt)}. New orders and new shifts are blocked; open orders can still be billed and settled.`
            : `${timeLeft(status.msLeft)} left — until ${dateOf(status.expiresAt)}.`}
        </div>
      </div>

      <div className="card" style={{ padding: 24, display: 'grid', gap: 12 }}>
        <div className="label">Install ID</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <code style={{
            flex: 1, padding: '10px 12px', background: 'var(--surface-alt)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-input)', fontSize: 15, userSelect: 'all', wordBreak: 'break-all',
          }}>{status.installId}</code>
          <Button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          Send this to your supplier to buy or renew. It moves with your backups, so restoring onto a replacement PC keeps the licence.
        </div>
      </div>

      <div className="card" style={{ padding: 24, display: 'grid', gap: 12 }}>
        <div className="label">Activate a licence key</div>
        <textarea
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="POS1.…"
          rows={4}
          spellCheck={false}
          style={{
            padding: 12, border: '1px solid var(--border-strong)', borderRadius: 'var(--r-input)',
            fontFamily: 'ui-monospace, monospace', fontSize: 13, resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" disabled={busy || key.trim() === ''} onClick={() => void activate()}>
            {busy ? 'Activating…' : 'Activate'}
          </Button>
        </div>
      </div>
    </div>
  )
}
