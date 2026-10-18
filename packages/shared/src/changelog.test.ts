import { describe, expect, it } from 'vitest'
import { androidVersionCode, compareVersions, entryToMarkdown, notesBetween, parseChangelog } from './changelog.js'

const MD = `# Changelog

Intro text that is not a note.

## [Unreleased]
### Added
- Coming soon

## [1.1.0] - 2026-10-20
### Added
- Update button on the counter
- Tablets update from the counter,
  without a cable
### Fixed
- KOT number

## [1.0.0] - 2026-10-08
- First release

[1.1.0]: https://example.com/v1.1.0
`

describe('parseChangelog', () => {
  const entries = parseChangelog(MD)

  it('reads every version with its date and sections', () => {
    expect(entries.map((e) => [e.version, e.date])).toEqual([
      ['Unreleased', null], ['1.1.0', '2026-10-20'], ['1.0.0', '2026-10-08'],
    ])
    expect(entries[1]!.sections).toEqual([
      { title: 'Added', items: ['Update button on the counter', 'Tablets update from the counter, without a cable'] },
      { title: 'Fixed', items: ['KOT number'] },
    ])
  })

  it('puts bullets without a heading under "Changes" and ignores link references', () => {
    expect(entries[2]!.sections).toEqual([{ title: 'Changes', items: ['First release'] }])
  })

  it('renders one version back to Markdown', () => {
    expect(entryToMarkdown(entries[1]!)).toBe(
      '### Added\n- Update button on the counter\n- Tablets update from the counter, without a cable\n\n### Fixed\n- KOT number',
    )
  })
})

describe('notesBetween', () => {
  const entries = parseChangelog(MD)
  it('returns the versions after "from" up to "to", newest first, never Unreleased', () => {
    expect(notesBetween(entries, '0.9.0', '1.1.0').map((e) => e.version)).toEqual(['1.1.0', '1.0.0'])
    expect(notesBetween(entries, '1.0.0', '1.1.0').map((e) => e.version)).toEqual(['1.1.0'])
    expect(notesBetween(entries, null, '1.0.0').map((e) => e.version)).toEqual(['1.0.0'])
    expect(notesBetween(entries, '1.1.0', '1.1.0')).toEqual([])
  })
})

describe('versions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.0.0', 'Unreleased')).toBeGreaterThan(0)
  })

  it('derives an Android versionCode that always goes up', () => {
    expect(androidVersionCode('1.1.0')).toBe(10100)
    expect(androidVersionCode('1.2.3')).toBeLessThan(androidVersionCode('1.3.0'))
    expect(androidVersionCode('2.0.0')).toBeGreaterThan(androidVersionCode('1.99.99'))
    expect(() => androidVersionCode('1.100.0')).toThrow()
  })
})
