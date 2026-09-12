import { useWindowDimensions } from 'react-native'

/**
 * Material window size classes — the standard Android breakdown, and it maps
 * onto the three designs we already have.
 *
 *   compact  (<600dp)   phone, either rotation   → one pane, cart in a sheet
 *   medium   (600-899)  tablet portrait          → two panes, cart in a sheet
 *   expanded (>=900)    tablet landscape         → three panes, cart pinned
 *
 * Width alone is not enough: a phone in landscape is wide but only ~360dp tall,
 * so `isShort` tightens vertical padding rather than pretending it is a tablet.
 */
export type SizeClass = 'compact' | 'medium' | 'expanded'

export interface Layout {
  width: number
  height: number
  size: SizeClass
  isCompact: boolean
  isExpanded: boolean
  /** Phone in landscape — little vertical room. */
  isShort: boolean
  /** Columns for the menu item grid. */
  itemColumns: number
  /** Columns for the table grid. */
  tableColumns: number
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions()
  const size: SizeClass = width >= 900 ? 'expanded' : width >= 600 ? 'medium' : 'compact'
  const isShort = height < 500

  return {
    width,
    height,
    size,
    isCompact: size === 'compact',
    isExpanded: size === 'expanded',
    isShort,
    itemColumns: size === 'expanded' ? 4 : size === 'medium' ? 3 : 2,
    tableColumns: size === 'expanded' ? 6 : size === 'medium' ? 4 : 3,
  }
}

/**
 * Exact tile width for a `columns`-wide grid, so tiles line up instead of
 * relying on flexBasis percentages that drift once gaps are added.
 */
export function tileWidth(available: number, columns: number, gap: number): number {
  return Math.floor((available - gap * (columns - 1)) / columns)
}
