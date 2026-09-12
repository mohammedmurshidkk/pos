import type { TextStyle } from 'react-native'

/**
 * Design tokens — the waiter app's dark theme from docs/02-design-system.md.
 *
 * Nothing in a screen hardcodes a colour or a size. When the client wants the
 * accent changed, it changes here and nowhere else.
 */
export const color = {
  bg: '#0B1220',
  surface: '#151E31',
  surfaceAlt: '#1E293B',
  border: '#2D3B54',
  borderStrong: '#3E4F6E',

  text: '#F1F5F9',
  textMuted: '#94A3B8',
  textFaint: '#64748B',

  primary: '#4F46E5',
  primaryPressed: '#4338CA',
  primarySubtle: '#1E1B4B',
  onPrimary: '#FFFFFF',

  success: '#16A34A',
  warning: '#F59E0B',
  danger: '#DC2626',
  info: '#0EA5E9',
} as const

/** Left borders and chips only — never a full tile fill, it makes grids unreadable. */
export const orderTypeColor = {
  dine_in: '#4F46E5',
  takeaway: '#F59E0B',
  car: '#06B6D4',
  delivery: '#8B5CF6',
} as const

export const orderTypeLabel = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  car: 'Car',
  delivery: 'Delivery',
} as const

export type OrderType = keyof typeof orderTypeColor

/** 4px scale. */
export const space = { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40 } as const

export const radius = { input: 6, button: 10, card: 12, modal: 16, pill: 999 } as const

/**
 * Touch targets. A waiter taps these mid-service with one hand while carrying
 * plates — 56 is the floor, 64 is what we actually want.
 */
export const touch = { min: 56, comfortable: 64, tile: 120 } as const

export const font: Record<string, TextStyle> = {
  title: { fontSize: 24, fontWeight: '600' },
  heading: { fontSize: 18, fontWeight: '600' },
  /** Larger than a phone app: glanced at, not read. */
  body: { fontSize: 17, fontWeight: '500' },
  label: { fontSize: 13, fontWeight: '500', letterSpacing: 0.6 },
  caption: { fontSize: 12, fontWeight: '400' },
  /** Tabular figures: without them a column of prices jitters as digits change width. */
  money: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  moneyLarge: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
}

/** Borders over shadows — cheap POS panels turn shadows into grey mud. */
export const hairline = { borderWidth: 1, borderColor: color.border } as const
