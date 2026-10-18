import type { ReactNode } from 'react'
import type { ChangelogEntry } from '../updates'

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric',
})

/** CHANGELOG.md only uses **bold** inside a line; everything else is plain text. */
function inline(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))
}

/** One block per version, newest first, as written in CHANGELOG.md. */
export function ReleaseNotes({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {entries.map((e) => (
        <section key={e.version} style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {e.version === 'Unreleased' ? 'Not released yet' : `Version ${e.version}`}
            </h2>
            {e.date ? <span className="muted">{day(e.date)}</span> : null}
          </div>
          {e.sections.filter((s) => s.items.length).map((s) => (
            <div key={s.title}>
              <div className="muted" style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {s.title}
              </div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20, display: 'grid', gap: 4, lineHeight: 1.45 }}>
                {s.items.map((item, i) => <li key={i}>{inline(item)}</li>)}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
