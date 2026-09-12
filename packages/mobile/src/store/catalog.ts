import { create } from 'zustand'
import { api } from '../api/client'
import type { Bootstrap, Item, Modifier, ModifierGroup, Table } from '../api/types'

interface CatalogState {
  data: Bootstrap | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
  itemsIn: (categoryId: string | null) => Item[]
  tablesIn: (areaId: string) => Table[]
  employee: (id: string | null | undefined) => string
  groupsForItem: (itemId: string) => ModifierGroup[]
  modifiersIn: (groupId: string) => Modifier[]
  money: (minor: number) => string
}

/**
 * Menu, areas, tables and staff. Refreshed on launch and on demand.
 *
 * ⚠️ Never CALL these helpers inside a zustand selector — `useCatalog((s) =>
 * s.itemsIn(x))` returns a fresh array every render, which fails the Object.is
 * check and loops until React throws "Maximum update depth exceeded". Select
 * the function, then call it inside useMemo with `data` in the deps.
 */
export const useCatalog = create<CatalogState>((set, get) => ({
  data: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      set({ data: await api.bootstrap(), loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load' })
      throw e
    }
  },

  itemsIn: (categoryId) => {
    const items = get().data?.items ?? []
    const list = categoryId ? items.filter((i) => i.categoryId === categoryId) : items
    return [...list].sort((a, b) => a.sort - b.sort)
  },

  tablesIn: (areaId) =>
    [...(get().data?.tables ?? [])].filter((t) => t.areaId === areaId).sort((a, b) => a.sort - b.sort),

  employee: (id) => get().data?.employees.find((e) => e.id === id)?.name ?? 'Unknown',

  /** Modifier groups attached to an item, in display order. */
  groupsForItem: (itemId) => {
    const d = get().data
    if (!d) return []
    const ids = d.itemModifierGroups
      .filter((l) => l.itemId === itemId)
      .sort((a, b) => a.sort - b.sort)
      .map((l) => l.groupId)
    return ids
      .map((id) => d.modifierGroups.find((g) => g.id === id))
      .filter((g): g is ModifierGroup => !!g)
  },

  modifiersIn: (groupId) =>
    [...(get().data?.modifiers ?? [])]
      .filter((m) => m.groupId === groupId)
      .sort((a, b) => a.sort - b.sort),

  /** Minor units → display string. Decimals and symbol come from the hub. */
  money: (minor) => {
    const s = get().data?.settings
    const decimals = s?.currencyDecimals ?? 2
    const factor = 10 ** decimals
    const neg = minor < 0
    const abs = Math.abs(minor)
    const whole = Math.floor(abs / factor).toLocaleString('en-US')
    const frac = String(abs % factor).padStart(decimals, '0')
    return `${neg ? '-' : ''}${decimals ? `${whole}.${frac}` : whole}`
  },
}))
