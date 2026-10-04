import { create } from 'zustand'
import { api } from './api/client'
import type { Bootstrap, Employee, Printer } from './api/types'

interface State {
  data: Bootstrap | null
  printers: Printer[]
  /** False until the first printer check answers: empty then means "not known yet", not "none". */
  printersChecked: boolean
  /** Whoever is signed in at this counter — stamped on every action. */
  operator: Employee | null
  counterId: string | null
  error: string | null

  load: () => Promise<void>
  refreshPrinters: () => Promise<void>
  /** Waiting and failed print jobs per printer, for the header and Dashboard. */
  jobCounts: Record<string, { pending: number; failed: number }>
  refreshJobs: () => Promise<void>
  /** The print queue panel, opened from the header strip or the Dashboard. */
  queueOpen: boolean
  setQueueOpen: (open: boolean) => void
  signIn: (employee: Employee) => void
  signOut: () => void
  /**
   * The admin screens (Setup, Settings, Devices, Licence) ask for the PIN again.
   * Memory only, and dropped when the cashier leaves that area or signs out.
   */
  adminUnlocked: boolean
  setAdminUnlocked: (unlocked: boolean) => void
  setCounter: (id: string) => void
  money: (minor: number) => string
  employeeName: (id: string | null | undefined) => string
}

const OPERATOR_KEY = 'pos.operator'
const COUNTER_KEY = 'pos.counter'

const restoreOperator = (): Employee | null => {
  try {
    const raw = sessionStorage.getItem(OPERATOR_KEY)
    return raw ? (JSON.parse(raw) as Employee) : null
  } catch {
    return null
  }
}

export const useStore = create<State>((set, get) => ({
  data: null,
  printers: [],
  printersChecked: false,
  jobCounts: {},
  queueOpen: false,
  adminUnlocked: false,
  operator: restoreOperator(),
  counterId: null,
  error: null,

  load: async () => {
    try {
      const data = await api.bootstrap()
      // A till never moves, so remember which counter this PC is — but check it
      // still exists on every load, not only when state is empty. An open tab
      // keeps its counter id across a re-seed, and counter_id is a foreign key
      // on payments: a stale one gets all the way to settlement before failing.
      let counterId = get().counterId
      if (!counterId) {
        try { counterId = localStorage.getItem(COUNTER_KEY) } catch { /* ignore */ }
      }
      if (!counterId || !data.counters.some((c) => c.id === counterId)) {
        counterId = data.counters[0]?.id ?? null
        try {
          if (counterId) localStorage.setItem(COUNTER_KEY, counterId)
          else localStorage.removeItem(COUNTER_KEY)
        } catch { /* private mode */ }
      }
      // The operator gets the same reconciliation the counter just got. A stored
      // employee whose id is no longer live — a re-seeded database, or a cashier
      // deactivated mid-shift — must not stay signed in: every write stamps that
      // id, and the hub rejects an unknown one. Left unchecked the screen looks
      // normal and only fails at the moment money is taken. Re-reading the row
      // also picks up permission changes made since sign-in.
      const stored = get().operator
      const operator = stored ? data.employees.find((e) => e.id === stored.id) ?? null : null
      try {
        if (operator) sessionStorage.setItem(OPERATOR_KEY, JSON.stringify(operator))
        else sessionStorage.removeItem(OPERATOR_KEY)
      } catch { /* private mode */ }

      set({ data, counterId, operator, error: null })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not reach the hub' })
    }
  },

  refreshPrinters: async () => {
    try {
      // Clearing the error here is what makes a stale banner disappear once the
      // hub is answering again — `load` only re-runs while `data` is null.
      set({ printers: await api.printers(), printersChecked: true, error: null })
    } catch { /* header dots just go stale */ }
  },

  refreshJobs: async () => {
    try {
      set({ jobCounts: (await api.printJobs()).counts })
    } catch { /* the badge just goes stale */ }
  },
  setQueueOpen: (queueOpen) => set({ queueOpen }),

  /**
   * Kept in sessionStorage, not localStorage: reloading the window should not
   * sign the cashier out, but closing the app should.
   */
  signIn: (employee) => {
    try { sessionStorage.setItem(OPERATOR_KEY, JSON.stringify(employee)) } catch { /* private mode */ }
    set({ operator: employee })
  },
  signOut: () => {
    try { sessionStorage.removeItem(OPERATOR_KEY) } catch { /* ignore */ }
    set({ operator: null, adminUnlocked: false })
  },
  setAdminUnlocked: (adminUnlocked) => set({ adminUnlocked }),
  setCounter: (id) => {
    try { localStorage.setItem(COUNTER_KEY, id) } catch { /* ignore */ }
    set({ counterId: id })
  },

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
