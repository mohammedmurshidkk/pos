import { describe, expect, it } from 'vitest'
import { kotKindForSeq, nextKotSeq, routeToKitchens, type RoutableLine } from './kot.js'

const ARABIC = 'k-arabic'
const CHINESE = 'k-chinese'
const JUICE = 'k-juice'
const DEFAULT = 'k-main'

const line = (id: string, kitchenId: string | null, name: string): RoutableLine => ({
  id,
  kitchenId,
  qty: 1,
  name,
})

describe('routeToKitchens', () => {
  it('splits the spec example into three tickets', () => {
    // 1 periperi alfaham + 1 chicken noodles + 1 apple juice
    const groups = routeToKitchens(
      [
        line('1', ARABIC, 'Periperi Alfaham'),
        line('2', CHINESE, 'Chicken Noodles'),
        line('3', JUICE, 'Apple Juice'),
      ],
      DEFAULT,
    )
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.kitchenId)).toEqual([ARABIC, CHINESE, JUICE])
    expect(groups.every((g) => g.lines.length === 1)).toBe(true)
  })

  it('produces one ticket for a single-printer shop', () => {
    // Every category points at the one kitchen — not a special code path.
    const groups = routeToKitchens(
      [line('1', DEFAULT, 'Alfaham'), line('2', DEFAULT, 'Noodles'), line('3', DEFAULT, 'Juice')],
      DEFAULT,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.lines).toHaveLength(3)
  })

  it('collects multiple lines for the same kitchen onto one ticket', () => {
    const groups = routeToKitchens(
      [
        line('1', ARABIC, 'Periperi Alfaham'),
        line('2', CHINESE, 'Chicken Noodles'),
        line('3', ARABIC, 'Kanthari Alfaham'),
      ],
      DEFAULT,
    )
    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.kitchenId === ARABIC)!.lines).toHaveLength(2)
  })

  it('falls back to the default kitchen rather than dropping a line', () => {
    // A category with no kitchen must never cause a lost ticket.
    const groups = routeToKitchens([line('1', null, 'Tiramisu')], DEFAULT)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.kitchenId).toBe(DEFAULT)
  })

  it('merges unassigned lines with lines already going to the default kitchen', () => {
    const groups = routeToKitchens(
      [line('1', null, 'Tiramisu'), line('2', DEFAULT, 'Shawarma')],
      DEFAULT,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.lines).toHaveLength(2)
  })

  it('returns nothing for an empty send', () => {
    expect(routeToKitchens([], DEFAULT)).toEqual([])
  })

  it('preserves first-appearance order so screen and printers agree', () => {
    const groups = routeToKitchens(
      [line('1', JUICE, 'Juice'), line('2', ARABIC, 'Alfaham'), line('3', JUICE, 'Shake')],
      DEFAULT,
    )
    expect(groups.map((g) => g.kitchenId)).toEqual([JUICE, ARABIC])
  })
})

describe('KOT sequencing', () => {
  it('starts at 1 and increments per send', () => {
    expect(nextKotSeq([])).toBe(1)
    expect(nextKotSeq([1])).toBe(2)
    expect(nextKotSeq([1, 2, 3])).toBe(4)
  })

  it('labels the first send new and every later send an add-on', () => {
    expect(kotKindForSeq(1)).toBe('new')
    expect(kotKindForSeq(2)).toBe('addon')
  })
})
