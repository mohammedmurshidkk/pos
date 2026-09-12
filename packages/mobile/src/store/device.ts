import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { setBaseUrl } from '../api/client'

const KEY = 'pos.device.v1'

interface DeviceState {
  hubUrl: string | null
  deviceName: string
  /** Preselected in the print-bill sheet; changing it makes the change stick. */
  defaultCounterId: string | null
  pairedAt: string | null
  hydrated: boolean

  hydrate: () => Promise<void>
  pair: (hubUrl: string, deviceName?: string) => Promise<void>
  unpair: () => Promise<void>
  setDefaultCounter: (id: string) => Promise<void>
}

/**
 * The device's identity. Deliberately small: there is no employee session here
 * because the app has no login — identity is captured per action instead.
 */
export const useDevice = create<DeviceState>((set, get) => ({
  hubUrl: null,
  deviceName: 'Tablet',
  defaultCounterId: null,
  pairedAt: null,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<DeviceState>
        setBaseUrl(saved.hubUrl ?? null)
        set({ ...saved, hydrated: true })
        return
      }
    } catch { /* first run, or storage cleared */ }
    set({ hydrated: true })
  },

  pair: async (hubUrl, deviceName) => {
    const next = {
      hubUrl,
      deviceName: deviceName ?? get().deviceName,
      defaultCounterId: get().defaultCounterId,
      pairedAt: new Date().toISOString(),
    }
    setBaseUrl(hubUrl)
    set(next)
    await AsyncStorage.setItem(KEY, JSON.stringify(next))
  },

  unpair: async () => {
    setBaseUrl(null)
    set({ hubUrl: null, defaultCounterId: null, pairedAt: null })
    await AsyncStorage.removeItem(KEY)
  },

  setDefaultCounter: async (id) => {
    set({ defaultCounterId: id })
    const { hubUrl, deviceName, pairedAt } = get()
    await AsyncStorage.setItem(KEY, JSON.stringify({ hubUrl, deviceName, defaultCounterId: id, pairedAt }))
  },
}))
