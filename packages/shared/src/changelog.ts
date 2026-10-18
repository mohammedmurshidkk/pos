/**
 * CHANGELOG.md at the repo root is the release notes: one section per version,
 * Keep a Changelog style. The counter's "update available" dialog, the tablet's
 * update screen and the GitHub release body are all cut from it, so it is
 * written for the shop, not for developers (that is docs/CHANGELOG.md).
 *
 *   ## [Unreleased]
 *   ## [1.1.0] - 2026-10-20
 *   ### Added
 *   - Something the shop can now do.
 */

export interface ChangelogSection {
  /** "Added", "Changed", "Fixed"… */
  title: string
  items: string[]
}

export interface ChangelogEntry {
  /** "1.1.0", or "Unreleased". */
  version: string
  /** YYYY-MM-DD, or null when the heading has none. */
  date: string | null
  sections: ChangelogSection[]
}

const VERSION_HEADING = /^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/
const SECTION_HEADING = /^###\s+(.+?)\s*$/
const ITEM = /^\s*[-*]\s+(.*)$/

/** Every version section, in file order (newest first by convention). */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let entry: ChangelogEntry | null = null
  let section: ChangelogSection | null = null

  for (const line of markdown.split(/\r?\n/)) {
    const v = VERSION_HEADING.exec(line)
    if (v) {
      entry = { version: v[1]!.trim(), date: v[2] ?? null, sections: [] }
      entries.push(entry)
      section = null
      continue
    }
    // Link references and anything above the first version are not notes.
    if (!entry) continue
    if (/^#{1,2}\s/.test(line)) { entry = null; continue }

    const h = SECTION_HEADING.exec(line)
    if (h) {
      section = { title: h[1]!, items: [] }
      entry.sections.push(section)
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      if (!section) {
        section = { title: 'Changes', items: [] }
        entry.sections.push(section)
      }
      section.items.push(item[1]!.trim())
      continue
    }
    // A wrapped bullet continues the previous item.
    if (line.trim() && section && section.items.length && /^\s+/.test(line)) {
      const last = section.items.length - 1
      section.items[last] = `${section.items[last]} ${line.trim()}`
    }
  }
  return entries
}

/** "1.10.0" > "1.9.3". Anything that is not x.y.z sorts below every version. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0)
  for (let i = 0; i < 3; i++) {
    const d = pa[i]! - pb[i]!
    if (d !== 0) return d
  }
  return 0
}

export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/**
 * The notes someone on `from` has not seen, up to and including `to`: an
 * update that skips versions shows all of them, newest first.
 */
export function notesBetween(entries: ChangelogEntry[], from: string | null, to: string): ChangelogEntry[] {
  return entries
    .filter((e) => parseVersion(e.version))
    .filter((e) => compareVersions(e.version, to) <= 0 && (!from || compareVersions(e.version, from) > 0))
    .sort((a, b) => compareVersions(b.version, a.version))
}

/**
 * Android refuses an update whose versionCode is not higher, so it is derived
 * from the version rather than kept by hand: 1.2.3 → 10203. Minor and patch
 * must stay below 100.
 */
export function androidVersionCode(version: string): number {
  const p = parseVersion(version)
  if (!p) throw new Error(`"${version}" is not a version like 1.2.3`)
  if (p[1] > 99 || p[2] > 99) throw new Error(`${version}: minor and patch must be below 100`)
  return p[0] * 10_000 + p[1] * 100 + p[2]
}

/** One version's notes as Markdown, for the GitHub release body. */
export function entryToMarkdown(entry: ChangelogEntry): string {
  return entry.sections
    .filter((s) => s.items.length)
    .map((s) => `### ${s.title}\n${s.items.map((i) => `- ${i}`).join('\n')}`)
    .join('\n\n')
}
