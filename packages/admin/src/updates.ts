import { useEffect, useState } from 'react'
import { desktop } from './desktop'

/** Mirrors @pos/shared changelog.ts — the admin UI does not depend on that package. */
export interface ChangelogEntry {
  version: string
  date: string | null
  sections: { title: string; items: string[] }[]
}

/** Mirrors desktop/src/updates.ts. */
export type UpdateState =
  | { status: 'unsupported' }
  | { status: 'idle' | 'checking' | 'latest'; checkedAt: string | null }
  | { status: 'available' | 'downloading'; version: string; percent: number; notes: ChangelogEntry[] }
  | { status: 'ready'; version: string; notes: ChangelogEntry[] }
  | { status: 'error'; message: string; checkedAt: string | null }

/** GET /api/changelog. */
export interface ChangelogResponse {
  version: string | null
  entries: ChangelogEntry[]
  /** The tablet app the hub holds for tablets to update from. */
  tabletApk: { version: string; size: number } | null
}

/**
 * The counter app's update state, live. In a plain browser, or an app from
 * before updates existed, there is nothing to update: 'unsupported'.
 */
export function useAppUpdate(): UpdateState {
  const [state, setState] = useState<UpdateState>({ status: 'unsupported' })
  useEffect(() => {
    const bridge = desktop()
    if (!bridge?.getUpdate || !bridge.onUpdateChange) return
    void bridge.getUpdate().then(setState).catch(() => {})
    return bridge.onUpdateChange(setState)
  }, [])
  return state
}
