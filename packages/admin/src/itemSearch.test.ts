import { describe, expect, it } from 'vitest'
import { isExactShortName, searchItems } from './itemSearch'

const items = [
  { name: 'Club Sandwich', shortName: null },
  { name: 'Chicken Biriyani', shortName: 'cb' },
  { name: 'Chicken Burger', shortName: 'cbg' },
  { name: 'Mutton Biriyani', shortName: 'MB' },
]

describe('item search', () => {
  it('finds an item by its short name, ahead of name matches', () => {
    expect(searchItems(items, 'cb').map((i) => i.name)).toEqual(['Chicken Biriyani', 'Chicken Burger'])
  })

  it('ignores case and spaces around the query', () => {
    expect(searchItems(items, ' mb ').map((i) => i.name)).toEqual(['Mutton Biriyani'])
  })

  it('still matches any part of the name', () => {
    expect(searchItems(items, 'biri').map((i) => i.name)).toEqual(['Chicken Biriyani', 'Mutton Biriyani'])
  })

  it('returns nothing for an empty query', () => {
    expect(searchItems(items, '  ')).toEqual([])
  })

  it('knows an exact short name', () => {
    expect(isExactShortName(items[1]!, 'CB')).toBe(true)
    expect(isExactShortName(items[2]!, 'cb')).toBe(false)
  })
})
