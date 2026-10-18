import { useState } from 'react'
import { desktop } from '../desktop'
import { useAppUpdate, type UpdateState } from '../updates'
import { ReleaseNotes } from './ReleaseNotes'
import { Banner, Button, Modal } from './ui'

/**
 * Top bar: appears only when a new version of the counter app is on its way or
 * ready. Tapping it shows what is new and, once downloaded, Restart and update.
 */
export function UpdatePill() {
  const state = useAppUpdate()
  const [open, setOpen] = useState(false)
  if (state.status !== 'available' && state.status !== 'downloading' && state.status !== 'ready') return null

  const ready = state.status === 'ready'
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          height: 48, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8,
          borderRadius: 'var(--r-button)', cursor: 'pointer', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap',
          border: `1px solid ${ready ? 'var(--primary)' : 'var(--border-strong)'}`,
          background: ready ? 'var(--primary-subtle)' : 'var(--surface)',
          color: ready ? 'var(--primary)' : 'var(--text)', touchAction: 'manipulation',
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--primary)' }} />
        {ready ? `Update ${state.version} ready` : `Update ${state.version}`}
      </button>
      {open ? <UpdateDialog state={state} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function UpdateDialog({ state, onClose }: {
  state: Extract<UpdateState, { version: string }>
  onClose: () => void
}) {
  const [restarting, setRestarting] = useState(false)
  const ready = state.status === 'ready'

  const install = async () => {
    setRestarting(true)
    const ok = await desktop()?.installUpdate?.().catch(() => false)
    if (!ok) setRestarting(false)
  }

  return (
    <Modal
      title={`Version ${state.version} is available`}
      subtitle={ready
        ? 'Downloaded and ready to install.'
        : `Downloading in the background${state.status === 'downloading' ? ` — ${state.percent}%` : '…'} The till keeps working meanwhile.`}
      onClose={onClose}
      width={680}
    >
      {state.notes.length
        ? <ReleaseNotes entries={state.notes} />
        : <div className="muted">The list of changes could not be loaded. It is in Settings → Updates after updating.</div>}

      {ready ? (
        <Banner tone="info">
          The counter closes for about a minute while it updates, then opens again by itself. Tablets
          reconnect on their own; orders and settings are kept. Windows may ask to allow the change.
        </Banner>
      ) : null}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>{ready ? 'Later' : 'Close'}</Button>
        {ready ? (
          <Button variant="primary" disabled={restarting} onClick={() => void install()}>
            {restarting ? 'Restarting…' : 'Restart and update'}
          </Button>
        ) : null}
      </div>
    </Modal>
  )
}
