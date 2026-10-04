import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { BackupStatus } from '../api/types'
import { Banner, Button, EmptyState, Field, inputStyle } from '../components/ui'
import { useStore } from '../store'

export const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

const at = (iso: string) => new Date(iso).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

/**
 * Settings → Backup. A backup is a full copy of the database: every sale,
 * invoice and setting. One is taken at every shift close, once a day if the
 * shop forgets to close, and whenever someone presses Backup now. Copies older
 * than the retention window are removed, but the newest is always kept.
 *
 * The folder should be on a different drive (or a USB stick) when the PC has
 * one: a backup on the same disk does not survive the disk.
 */
export function BackupSettings() {
  const { operator } = useStore()
  const [st, setSt] = useState<BackupStatus | null>(null)
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState<'backup' | 'folder' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api.backups()
      setSt(next)
      setFolder((f) => f || next.dir)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  if (!st) return error ? <Banner tone="danger">{error}</Banner> : <EmptyState title="Loading…" />

  const run = async (kind: 'backup' | 'folder', fn: () => Promise<BackupStatus>, ok: string) => {
    if (!operator) return setError('Sign in at the counter first.')
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      const next = await fn()
      setSt(next)
      setFolder(next.dir)
      setNotice(ok)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  const folderChanged = folder.trim() !== '' && folder.trim() !== st.dir

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {st.lastError ? (
        <Banner tone="danger">
          The last backup failed {ago(st.lastError.at)}: {st.lastError.message}
        </Banner>
      ) : st.overdue ? (
        <Banner tone="warning">
          {st.lastBackupAt ? `No backup since ${at(st.lastBackupAt)}.` : 'No backup has been taken yet.'} Press Backup now.
        </Banner>
      ) : null}

      <div className="card" style={{ padding: 24, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1, display: 'grid', gap: 4 }}>
            <span className="muted" style={{ fontSize: 13 }}>Last backup</span>
            <span style={{ fontSize: 22, fontWeight: 700 }}>
              {st.lastBackupAt ? ago(st.lastBackupAt) : 'Never'}
            </span>
            {st.lastBackupAt ? <span className="faint" style={{ fontSize: 13 }}>{at(st.lastBackupAt)}</span> : null}
          </div>
          <Button
            variant="primary" disabled={busy !== null}
            onClick={() => void run('backup', async () => (await api.backupNow(operator!.id)).status, 'Backup written.')}
          >{busy === 'backup' ? 'Backing up…' : 'Backup now'}</Button>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          Taken at every shift close, and once a day if no shift was closed. Backups older
          than {st.retentionDays} days are deleted; the newest one is always kept.
        </div>
      </div>

      <div className="card" style={{ padding: 24, display: 'grid', gap: 12 }}>
        <div>
          <h2>Backup folder</h2>
          <div className="muted" style={{ marginTop: 2 }}>
            Use another drive or a USB stick if this PC has one. A copy on the same disk is lost with the disk.
          </div>
        </div>
        <Field label={st.custom ? 'Folder' : 'Folder (default)'}>
          <input
            style={{ ...inputStyle, fontFamily: 'var(--font-mono, monospace)' }}
            value={folder} spellCheck={false}
            placeholder="D:\POS Backups"
            onChange={(e) => { setFolder(e.target.value); setNotice(null) }}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {st.custom ? (
            <Button disabled={busy !== null} onClick={() => void run('folder', () => api.setBackupFolder(null, operator!.id), 'Back to the default folder.')}>
              Use default folder
            </Button>
          ) : null}
          <Button
            variant="primary" disabled={!folderChanged || busy !== null}
            onClick={() => void run('folder', () => api.setBackupFolder(folder.trim(), operator!.id), 'Backup folder saved. The next backup goes there.')}
          >{busy === 'folder' ? 'Checking…' : 'Save folder'}</Button>
        </div>
      </div>

      <div className="card" style={{ padding: 24, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h2 style={{ flex: 1 }}>In this folder</h2>
          <span className="muted" style={{ fontSize: 13 }}>
            {st.count} backup{st.count === 1 ? '' : 's'} · {fileSize(st.totalBytes)}
          </span>
        </div>
        {st.recent.length === 0 ? <EmptyState title="No backups in this folder yet" /> : (
          <div style={{ display: 'grid' }}>
            {st.recent.map((b) => (
              <div key={b.name} style={{
                display: 'flex', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 14,
              }}>
                <span style={{ flex: 1, fontFamily: 'var(--font-mono, monospace)', overflowWrap: 'anywhere' }}>{b.name}</span>
                <span className="muted">{at(b.createdAt)}</span>
                <span className="muted" style={{ width: 70, textAlign: 'right' }}>{fileSize(b.bytes)}</span>
              </div>
            ))}
            {st.count > st.recent.length ? (
              <div className="faint" style={{ fontSize: 13, paddingTop: 8 }}>and {st.count - st.recent.length} older</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
