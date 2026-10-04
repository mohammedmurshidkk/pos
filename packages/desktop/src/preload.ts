import { contextBridge, ipcRenderer } from 'electron'

/**
 * The only bridge between the cashier UI and the Electron shell: kiosk on/off.
 *
 * Kiosk mode hides the Windows taskbar, so on a touch till with no keyboard the
 * user menu's "Exit full screen" is the only way back to Windows. The UI only
 * shows that item when this bridge exists — in a plain browser it is absent.
 */
contextBridge.exposeInMainWorld('desktop', {
  isKiosk: (): Promise<boolean> => ipcRenderer.invoke('kiosk:get'),
  setKiosk: (on: boolean): Promise<boolean> => ipcRenderer.invoke('kiosk:set', on),
})
