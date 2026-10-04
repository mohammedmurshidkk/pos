import type { ReactNode } from 'react'

export function Button({
  children, onClick, variant = 'secondary', disabled, type = 'button', style,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
  style?: React.CSSProperties
}) {
  const base: React.CSSProperties = {
    minHeight: 'var(--action-h)',
    padding: '0 16px',
    borderRadius: 'var(--r-button)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    fontWeight: 600,
  }
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--primary)', color: 'var(--on-primary)', border: '1px solid var(--primary)' },
    secondary: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-strong)' },
    ghost: { background: 'transparent', color: 'var(--text-muted)', border: '1px solid transparent' },
    danger: { background: 'var(--surface)', color: 'var(--danger)', border: '1px solid var(--danger)' },
  }
  return (
    <button type={type} disabled={disabled} onClick={onClick} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  )
}

const toneColor = {
  success: 'var(--success)', warning: 'var(--warning)',
  danger: 'var(--danger)', info: 'var(--info)', primary: 'var(--primary)',
} as const

/** Status always carries a word, never just a colour. */
export function Pill({ label, tone }: { label: string; tone: keyof typeof toneColor }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--r-input)',
      fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
      color: toneColor[tone], background: `color-mix(in srgb, ${toneColor[tone]} 14%, transparent)`,
    }}>{label}</span>
  )
}

export function Banner({ tone, children }: { tone: keyof typeof toneColor; children: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      borderRadius: 'var(--r-card)', border: `1px solid ${toneColor[tone]}`,
      background: `color-mix(in srgb, ${toneColor[tone]} 8%, transparent)`, color: toneColor[tone],
    }}>{children}</div>
  )
}

export function Modal({
  title, subtitle, onClose, children, width = 640,
}: { title?: string; subtitle?: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: '#0f172a66', display: 'grid',
        placeItems: 'center', zIndex: 50, padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto',
          background: 'var(--surface)', borderRadius: 'var(--r-modal)',
          border: '1px solid var(--border)', padding: 24,
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        {title ? (
          <div>
            <h1>{title}</h1>
            {subtitle ? <div className="muted">{subtitle}</div> : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

export const inputStyle: React.CSSProperties = {
  height: 'var(--control-h)', padding: '0 12px',
  border: '1px solid var(--border-strong)', borderRadius: 'var(--r-input)',
  background: 'var(--surface)',
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
      {hint ? <div style={{ marginTop: 4 }}>{hint}</div> : null}
    </div>
  )
}

/** Two letters: initials for a full name, the first two for a single name. */
export const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const source = parts.length > 1 ? parts.map((p) => p[0] ?? '').join('') : (parts[0] ?? '')
  return source.slice(0, 2).toUpperCase()
}
