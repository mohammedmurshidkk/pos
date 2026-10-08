/** The Electron shell's bridge (desktop/src/preload.ts). Absent in a plain browser. */
export interface DesktopBridge {
  isKiosk: () => Promise<boolean>
  setKiosk: (on: boolean) => Promise<boolean>
  minimize: () => Promise<void>
  close: () => Promise<void>
  onKioskChange: (listener: (on: boolean) => void) => () => void
}

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}

export const desktop = (): DesktopBridge | undefined => window.desktop
