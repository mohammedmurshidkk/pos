import { useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import { ReleaseNotes } from '../components/ReleaseNotes'
import { UpdateDialog } from '../components/UpdatePill'
import { Banner, Button, EmptyState } from '../components/ui'
import { desktop } from '../desktop'
import { useAppUpdate, type ChangelogResponse } from '../updates'
import { ago, fileSize } from './BackupSettings'

/**
 * Settings → Updates: which version this counter runs, whether a newer one is
 * coming, whether the tablets can update from this PC, and what changed in
 * every version (CHANGELOG.md, packed into the app).
 */
export function UpdateSettings() {
  const update = useAppUpdate()
  const [info, setInfo] = useState<ChangelogResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [dialog, setDialog] = useState(false)

  useEffect(() => {
    api.changelog().then(setInfo).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not reach the hub'))
  }, [])

  const check = async () => {
    setChecking(true)
    try { await desktop()?.checkForUpdate?.() } finally { setChecking(false) }
  }

  if (!info) return error ? <Banner tone="danger">{error}</Banner> : <EmptyState title="Loading…" />

  const released = info.entries.filter((e) => e.version !== 'Unreleased')
  const status =
    update.status === 'unsupported' ? 'Updates are checked by the Windows app only.'
    : update.status === 'checking' ? 'Checking for updates…'
    : update.status === 'latest' ? `Up to date${update.checkedAt ? ` · checked ${ago(update.checkedAt)}` : ''}.`
    : update.status === 'idle' ? 'Checks for updates by itself every few hours.'
    : update.status === 'error' ? `${update.message}${update.checkedAt ? ` Last checked ${ago(update.checkedAt)}.` : ''}`
    : update.status === 'ready' ? `Version ${update.version} is downloaded and ready to install.`
    : 'percent' in update ? `Version ${update.version} is downloading${update.status === 'downloading' ? ` — ${update.percent}%` : '…'}`
    : ''

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="muted" style={{ fontSize: 13 }}>This counter</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Version {info.version ?? 'development'}</div>
            <div className={update.status === 'error' ? undefined : 'muted'}
              style={update.status === 'error' ? { color: 'var(--warning)' } : undefined}>{status}</div>
          </div>
          {'version' in update ? (
            <Button variant="primary" onClick={() => setDialog(true)}>
              {update.status === 'ready' ? 'Restart and update' : 'What’s new'}
            </Button>
          ) : update.status !== 'unsupported' ? (
            <Button disabled={checking || update.status === 'checking'} onClick={() => void check()}>
              {checking || update.status === 'checking' ? 'Checking…' : 'Check for updates'}
            </Button>
          ) : null}
        </div>
      </div>

      <div style={card}>
        <div className="muted" style={{ fontSize: 13 }}>Tablets</div>
        {info.tabletApk ? (
          <div>
            Tablet app {info.tabletApk.version} ({fileSize(info.tabletApk.size)}) is on this PC. Tablets on an older
            version show <strong>Update available</strong> on their home screen and install it from here.
          </div>
        ) : (
          <div className="muted">
            The tablet app for this version has not been downloaded yet. It downloads by itself when this PC
            is online.
          </div>
        )}
      </div>

      <h2 style={{ margin: '8px 0 0' }}>What’s new</h2>
      {released.length ? <ReleaseNotes entries={released} /> : <EmptyState title="No release notes" />}

      {dialog && 'version' in update ? <UpdateDialog state={update} onClose={() => setDialog(false)} /> : null}
    </div>
  )
}

const card: React.CSSProperties = {
  display: 'grid', gap: 6, padding: 16, borderRadius: 'var(--r-card)',
  border: '1px solid var(--border)', background: 'var(--surface)',
}
