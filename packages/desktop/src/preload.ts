import { contextBridge, ipcRenderer } from 'electron'

/**
 * The only bridge between the cashier UI and the Electron shell: kiosk on/off,
 * the window buttons and app updates.
 *
 * Kiosk mode hides the Windows taskbar, and the window has no native frame, so
 * the UI draws its own title bar (admin/src/components/TitleBar.tsx) with
 * minimise, full screen on/off and close. The UI only shows those controls when
 * this bridge exists — in a plain browser it is absent.
 */
contextBridge.exposeInMainWorld('desktop', {
  isKiosk: (): Promise<boolean> => ipcRenderer.invoke('kiosk:get'),
  setKiosk: (on: boolean): Promise<boolean> => ipcRenderer.invoke('kiosk:set', on),
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  /** Updates — see updates.ts. */
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getUpdate: (): Promise<unknown> => ipcRenderer.invoke('update:get'),
  checkForUpdate: (): Promise<unknown> => ipcRenderer.invoke('update:check'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
  onUpdateChange: (listener: (state: unknown) => void): (() => void) => {
    const handler = (_e: unknown, state: unknown) => listener(state)
    ipcRenderer.on('update:changed', handler)
    return () => { ipcRenderer.removeListener('update:changed', handler) }
  },
  /** Kiosk can also change from the tray menu; the title bar follows. Returns an unsubscribe. */
  onKioskChange: (listener: (on: boolean) => void): (() => void) => {
    const handler = (_e: unknown, on: boolean) => listener(on)
    ipcRenderer.on('kiosk:changed', handler)
    return () => { ipcRenderer.removeListener('kiosk:changed', handler) }
  },
})
