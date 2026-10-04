import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import type { Item, OrderType } from '../api/types'

const KEY = 'pos.cart.v1'

export interface CartLine {
  key: string
  itemId: string
  name: string
  unitPrice: number
  qty: number
  note: string | null
  modifiers: { id: string; name: string; priceDelta: number }[]
}

export interface Draft {
  orderId: string | null
  type: OrderType
  tableId: string | null
  tableName: string | null
  ticketLabel: string | null
  vehicleNo: string | null
  bayNo: string | null
  phone: string | null
  address: string | null
  customerName: string | null
  lines: CartLine[]
}

const empty = (type: OrderType = 'dine_in'): Draft => ({
  orderId: null, type, tableId: null, tableName: null, ticketLabel: null,
  vehicleNo: null, bayNo: null, phone: null, address: null, customerName: null, lines: [],
})

interface CartState {
  draft: Draft
  hydrated: boolean
  hydrate: () => Promise<void>
  start: (partial: Partial<Draft> & { type: OrderType }) => void
  attachOrder: (orderId: string) => void
  add: (item: Item, qty?: number, note?: string | null, modifiers?: CartLine['modifiers']) => void
  setQty: (key: string, qty: number) => void
  /** Add, change or clear the kitchen note on a line already in the cart. */
  setNote: (key: string, note: string | null) => void
  remove: (key: string) => void
  clear: () => void
  subtotal: () => number
  count: () => number
}

const lineTotal = (l: CartLine) =>
  l.qty * (l.unitPrice + l.modifiers.reduce((a, m) => a + m.priceDelta, 0))

/**
 * The in-progress order.
 *
 * It belongs to the TABLET, not to an employee — there is no session, and on a
 * shared device whoever picks it up continues what is on screen. Persisted
 * because Android kills backgrounded apps during a rush, and a silently lost
 * order is how a waiter stops trusting the app.
 */
export const useCart = create<CartState>((set, get) => {
  const persist = () => {
    void AsyncStorage.setItem(KEY, JSON.stringify(get().draft)).catch(() => {})
  }

  return {
    draft: empty(),
    hydrated: false,

    hydrate: async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY)
        if (raw) set({ draft: JSON.parse(raw) as Draft, hydrated: true })
        else set({ hydrated: true })
      } catch {
        set({ hydrated: true })
      }
    },

    start: (partial) => {
      set({ draft: { ...empty(partial.type), ...partial } })
      persist()
    },

    attachOrder: (orderId) => {
      set({ draft: { ...get().draft, orderId } })
      persist()
    },

    add: (item, qty = 1, note = null, modifiers = []) => {
      const sig = `${item.id}|${note ?? ''}|${modifiers.map((m) => m.id).sort().join(',')}`
      const lines = [...get().draft.lines]
      // Identical item + note + modifiers merges instead of stacking duplicates.
      const existing = lines.find((l) => l.key === sig)
      if (existing) existing.qty += qty
      else lines.push({ key: sig, itemId: item.id, name: item.name, unitPrice: item.price, qty, note, modifiers })
      set({ draft: { ...get().draft, lines } })
      persist()
    },

    setQty: (key, qty) => {
      const lines = get().draft.lines
        .map((l) => (l.key === key ? { ...l, qty } : l))
        .filter((l) => l.qty > 0)
      set({ draft: { ...get().draft, lines } })
      persist()
    },

    setNote: (key, note) => {
      const line = get().draft.lines.find((l) => l.key === key)
      if (!line) return
      // The key is the merge signature (item + note + modifiers), so it changes
      // with the note. A line that now matches another one joins it.
      const sig = `${line.itemId}|${note ?? ''}|${line.modifiers.map((m) => m.id).sort().join(',')}`
      const others = get().draft.lines.filter((l) => l.key !== key)
      const twin = others.find((l) => l.key === sig)
      const lines = twin
        ? others.map((l) => (l === twin ? { ...l, qty: l.qty + line.qty } : l))
        : get().draft.lines.map((l) => (l.key === key ? { ...l, key: sig, note } : l))
      set({ draft: { ...get().draft, lines } })
      persist()
    },

    remove: (key) => {
      set({ draft: { ...get().draft, lines: get().draft.lines.filter((l) => l.key !== key) } })
      persist()
    },

    clear: () => {
      set({ draft: empty() })
      void AsyncStorage.removeItem(KEY).catch(() => {})
    },

    subtotal: () => get().draft.lines.reduce((a, l) => a + lineTotal(l), 0),
    count: () => get().draft.lines.reduce((a, l) => a + l.qty, 0),
  }
})

export const cartLineTotal = lineTotal
