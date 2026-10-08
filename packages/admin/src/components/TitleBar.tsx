import { useEffect, useState } from 'react'
import { brand } from '../brand'
import { desktop } from '../desktop'
import { Button, Modal } from './ui'

/** Height of the bar; 0 in a browser, where there is no bar. */
export const TITLE_BAR_H = 40

/**
 * The window's own title bar, drawn by the UI because the Electron window has
 * no native frame. Shown on every screen — sign-in, open counter, superadmin —
 * and only inside the desktop app.
 *
 *   [icon] Zentivo POS ··························· [ – ] [ ▢ ] [ ✕ ]
 *
 *  –  minimise; it comes back full screen.
 *  ▢  full screen (kiosk, taskbar hidden) ⇄ a normal window.
 *  ✕  hides the window; the hub keeps running for the tablets (tray icon).
 */
export function TitleBar() {
  const bridge = desktop()
  const [kiosk, setKiosk] = useState(true)
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => {
    if (!bridge) return
    bridge.isKiosk().then(setKiosk).catch(() => {})
    return bridge.onKioskChange(setKiosk)
  }, [bridge])

  if (!bridge) return null

  return (
    <>
      <div
        // Dragging moves the window when it is not full screen; buttons opt out.
        style={{
          height: TITLE_BAR_H, flexShrink: 0, display: 'flex', alignItems: 'center',
          background: 'var(--surface)', borderBottom: '1px solid var(--border)', userSelect: 'none',
          WebkitAppRegion: kiosk ? 'no-drag' : 'drag',
        } as React.CSSProperties}
        onDoubleClick={() => { void bridge.setKiosk(!kiosk) }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 14px', flex: 1, minWidth: 0 }}>
          <img src="/favicon.svg" alt="" width={18} height={18} style={{ borderRadius: 4 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{brand.productName}</span>
        </span>

        <WindowButton label="Minimise" onClick={() => { void bridge.minimize() }}>
          <path d="M3 8h10" />
        </WindowButton>
        <WindowButton
          label={kiosk ? 'Exit full screen' : 'Full screen'}
          onClick={() => { void bridge.setKiosk(!kiosk) }}
        >
          {kiosk
            ? <><rect x="3" y="5" width="8" height="8" rx="1" /><path d="M5.5 5V3.5a.5.5 0 0 1 .5-.5h6.5a.5.5 0 0 1 .5.5V10a.5.5 0 0 1-.5.5H11" /></>
            : <rect x="3" y="3" width="10" height="10" rx="1" />}
        </WindowButton>
        <WindowButton label="Close" danger onClick={() => setConfirmClose(true)}>
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
        </WindowButton>
      </div>

      {/* The hub must keep running for the tablets, so say what "close" does. */}
      {confirmClose ? (
        <Modal
          title={`Close ${brand.productName}?`}
          subtitle="The till keeps running in the background, so tablets can still send orders. Open it again from the tray icon or the desktop shortcut."
          onClose={() => setConfirmClose(false)}
          width={460}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Button onClick={() => setConfirmClose(false)} style={{ minHeight: 52 }}>Cancel</Button>
            <Button
              variant="danger"
              style={{ minHeight: 52 }}
              onClick={() => { setConfirmClose(false); void bridge.close() }}
            >
              Close window
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}

function WindowButton({ label, onClick, danger, children }: {
  label: string; onClick: () => void; danger?: boolean; children: React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        width: 56, height: TITLE_BAR_H, display: 'grid', placeItems: 'center', border: 'none',
        cursor: 'pointer', touchAction: 'manipulation',
        background: hover ? (danger ? 'var(--danger)' : 'var(--surface-alt)') : 'transparent',
        color: hover && danger ? '#ffffff' : 'var(--text)',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
        strokeLinecap="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}
