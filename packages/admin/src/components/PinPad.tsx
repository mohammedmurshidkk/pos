import { useEffect } from 'react'

export const PIN_LENGTH = 4

/**
 * Four dots and a 0–9 keypad, for sign-in and the admin re-check.
 *
 * The keypad is there for a touch till; a keyboard is faster on a desktop PC,
 * so digits, Backspace and Escape work too while the pad is on screen.
 */
export function PinPad({ value, onChange, onCancel, busy, hint }: {
  value: string
  onChange: (pin: string) => void
  onCancel?: () => void
  busy?: boolean
  hint?: string
}) {
  const add = (d: string) => { if (!busy && value.length < PIN_LENGTH) onChange(value + d) }
  const back = () => { if (!busy) onChange(value.slice(0, -1)) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) add(e.key)
      else if (e.key === 'Backspace') back()
      else if (e.key === 'Escape') onCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const key = (label: string, onClick: () => void, disabled = false) => (
    <button
      key={label || 'blank'}
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 72, fontSize: 26, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
        background: disabled ? 'transparent' : 'var(--surface)',
        border: disabled ? 'none' : '1px solid var(--border)',
        borderRadius: 'var(--r-button)', touchAction: 'manipulation',
      }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ display: 'grid', gap: 16, justifyItems: 'center' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} style={{
            width: 14, height: 14, borderRadius: 7,
            background: i < value.length ? 'var(--primary)' : 'transparent',
            border: `2px solid ${i < value.length ? 'var(--primary)' : 'var(--border-strong)'}`,
          }} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 88px)', gap: 10 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => key(n, () => add(n)))}
        {key('', () => {}, true)}
        {key('0', () => add('0'))}
        {key('⌫', back)}
      </div>

      <div className="faint" style={{ fontSize: 13 }}>
        {busy ? 'Checking…' : hint ?? 'Type the PIN, or use the number keys'}
      </div>
    </div>
  )
}
