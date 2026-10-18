import type { UpdateState } from './updates'

/** The Electron shell's bridge (desktop/src/preload.ts). Absent in a plain browser. */
export interface DesktopBridge {
  isKiosk: () => Promise<boolean>
  setKiosk: (on: boolean) => Promise<boolean>
  minimize: () => Promise<void>
  close: () => Promise<void>
  onKioskChange: (listener: (on: boolean) => void) => () => void
  /** Updates (desktop/src/updates.ts). Missing on an app older than 1.1.0. */
  appVersion?: () => Promise<string>
  getUpdate?: () => Promise<UpdateState>
  checkForUpdate?: () => Promise<UpdateState>
  installUpdate?: () => Promise<boolean>
  onUpdateChange?: (listener: (state: UpdateState) => void) => () => void
}

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}

export const desktop = (): DesktopBridge | undefined => window.desktop
