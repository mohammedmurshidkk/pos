import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { ApiError, OfflineError, api } from '../api/client'
import type { SubmitPayload } from '../api/types'

const KEY = 'pos.queue.v1'

export interface QueuedOrder {
  payload: SubmitPayload
  queuedAt: string
  /** Set when the hub rejected it outright — retrying will not help. */
  error?: string
}

interface QueueState {
  pending: QueuedOrder[]
  rejected: QueuedOrder[]
  draining: boolean
  hydrated: boolean

  hydrate: () => Promise<void>
  enqueue: (payload: SubmitPayload) => Promise<void>
  drain: () => Promise<void>
  discardRejected: () => Promise<void>
}

/**
 * Orders taken while the counter was unreachable.
 *
 * This is the difference between "the wifi dropped" being a shrug and being a
 * lost order. The waiter keeps taking orders; they go out when the hub is back.
 *
 * Retrying is safe because every entry carries a client-generated `batchRef`
 * and the hub treats a replayed ref as a no-op — so an order that actually
 * landed before the reply was lost never reaches the kitchen twice.
 */
export const useQueue = create<QueueState>((set, get) => {
  const persist = async () => {
    const { pending, rejected } = get()
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify({ pending, rejected }))
    } catch { /* storage full or unavailable — the in-memory queue still works */ }
  }

  return {
    pending: [],
    rejected: [],
    draining: false,
    hydrated: false,

    hydrate: async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY)
        if (raw) {
          const saved = JSON.parse(raw) as { pending: QueuedOrder[]; rejected: QueuedOrder[] }
          set({ pending: saved.pending ?? [], rejected: saved.rejected ?? [], hydrated: true })
          return
        }
      } catch { /* first run */ }
      set({ hydrated: true })
    },

    enqueue: async (payload) => {
      set({ pending: [...get().pending, { payload, queuedAt: new Date().toISOString() }] })
      await persist()
    },

    drain: async () => {
      if (get().draining || get().pending.length === 0) return
      set({ draining: true })
      try {
        // Oldest first, so the kitchen receives rounds in the order they were taken.
        while (get().pending.length > 0) {
          const next = get().pending[0]!
          try {
            await api.submit(next.payload)
            set({ pending: get().pending.slice(1) })
          } catch (e) {
            if (e instanceof OfflineError) return // still down — keep everything
            // Unpaired is not the order's fault. Keep it: it goes out once the
            // tablet has been paired again, instead of being set aside as rejected.
            if (e instanceof ApiError && e.status === 401) return
            // A 4xx will not fix itself. Set it aside so nothing vanishes silently.
            const error = e instanceof ApiError ? e.message : 'Could not be sent.'
            set({
              pending: get().pending.slice(1),
              rejected: [...get().rejected, { ...next, error }],
            })
          } finally {
            await persist()
          }
        }
      } finally {
        set({ draining: false })
      }
    },

    discardRejected: async () => {
      set({ rejected: [] })
      await persist()
    },
  }
})
