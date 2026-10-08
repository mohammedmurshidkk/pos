import { contextBridge, ipcRenderer } from 'electron'

/**
 * The only bridge between the cashier UI and the Electron shell: kiosk on/off
 * and the window buttons.
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
  /** Kiosk can also change from the tray menu; the title bar follows. Returns an unsubscribe. */
  onKioskChange: (listener: (on: boolean) => void): (() => void) => {
    const handler = (_e: unknown, on: boolean) => listener(on)
    ipcRenderer.on('kiosk:changed', handler)
    return () => { ipcRenderer.removeListener('kiosk:changed', handler) }
  },
})
