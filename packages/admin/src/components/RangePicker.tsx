import type { RangePreset, RangeQuery } from '../api/types'
import { inputStyle } from './ui'

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This week' },
  { id: 'this_month', label: 'This month' },
  { id: 'custom', label: 'Pick a day' },
]

/** "Pick a day" asks for one calendar day: midnight to midnight, local time. */
export function rangeQuery(preset: RangePreset, day: string): RangeQuery {
  if (preset !== 'custom') return { preset }
  const from = new Date(`${day}T00:00:00`)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)
  return { preset, from: from.toISOString(), to: to.toISOString() }
}

export function RangePicker({ preset, day, onPreset, onDay }: {
  preset: RangePreset
  day: string
  onPreset: (p: RangePreset) => void
  onDay: (d: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {PRESETS.map((p) => (
        <button
          key={p.id}
          onClick={() => onPreset(p.id)}
          style={{
            height: 32, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13,
            border: `1px solid ${preset === p.id ? 'var(--primary)' : 'var(--border)'}`,
            background: preset === p.id ? 'var(--primary-subtle)' : 'var(--surface)',
            color: preset === p.id ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 600,
          }}
        >
          {p.label}
        </button>
      ))}
      {preset === 'custom' ? (
        <input type="date" style={{ ...inputStyle, height: 32 }} value={day} onChange={(e) => onDay(e.target.value)} />
      ) : null}
    </div>
  )
}
