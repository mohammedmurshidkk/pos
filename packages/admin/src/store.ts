import { create } from 'zustand'
import { api } from './api/client'
import type { Bootstrap, Employee, Printer } from './api/types'

interface State {
  data: Bootstrap | null
  printers: Printer[]
  /** Whoever is signed in at this counter — stamped on every action. */
  operator: Employee | null
  counterId: string | null
  error: string | null

  load: () => Promise<void>
  refreshPrinters: () => Promise<void>
  signIn: (employee: Employee) => void
  signOut: () => void
  money: (minor: number) => string
  employeeName: (id: string | null | undefined) => string
}

export const useStore = create<State>((set, get) => ({
  data: null,
  printers: [],
  operator: null,
  counterId: null,
  error: null,

  load: async () => {
    try {
      const data = await api.bootstrap()
      set({ data, counterId: get().counterId ?? data.counters[0]?.id ?? null, error: null })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not reach the hub' })
    }
  },

  refreshPrinters: async () => {
    try { set({ printers: await api.printers() }) } catch { /* header dots just go stale */ }
  },

  signIn: (employee) => set({ operator: employee }),
  signOut: () => set({ operator: null }),

  /** Minor units → display. Decimals come from the hub, never hardcoded. */
  money: (minor) => {
    const d = get().data?.settings.currencyDecimals ?? 2
    const factor = 10 ** d
    const neg = minor < 0
    const abs = Math.abs(minor)
    const whole = Math.floor(abs / factor).toLocaleString('en-US')
    const frac = String(abs % factor).padStart(d, '0')
    // U+2212 so figures line up in tabular columns.
    return `${neg ? '−' : ''}${d ? `${whole}.${frac}` : whole}`
  },

  employeeName: (id) => get().data?.employees.find((e) => e.id === id)?.name ?? 'Counter',
}))
