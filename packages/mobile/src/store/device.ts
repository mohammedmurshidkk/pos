import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { setBaseUrl, setDeviceToken } from '../api/client'

const KEY = 'pos.device.v1'

interface Saved {
  hubUrl: string | null
  token: string | null
  deviceId: string | null
  deviceName: string
  defaultCounterId: string | null
  pairedAt: string | null
}

interface DeviceState extends Saved {
  hydrated: boolean
  hydrate: () => Promise<void>
  pair: (hubUrl: string, device: { token: string; deviceId: string; name: string }) => Promise<void>
  unpair: () => Promise<void>
  setDefaultCounter: (id: string) => Promise<void>
}

const empty: Saved = {
  hubUrl: null, token: null, deviceId: null, deviceName: 'Tablet', defaultCounterId: null, pairedAt: null,
}

/**
 * The device's identity. Deliberately small: there is no employee session here
 * because the app has no login — identity is captured per action instead.
 *
 * "Paired" means a hub address AND a token. A tablet upgraded from before
 * pairing tokens has an address but no token, and is sent to pair again rather
 * than failing every request.
 */
export const useDevice = create<DeviceState>((set, get) => {
  const persist = async () => {
    const { hubUrl, token, deviceId, deviceName, defaultCounterId, pairedAt } = get()
    await AsyncStorage.setItem(KEY, JSON.stringify({ hubUrl, token, deviceId, deviceName, defaultCounterId, pairedAt }))
  }

  return {
    ...empty,
    hydrated: false,

    hydrate: async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY)
        const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : null
        if (saved?.hubUrl && saved.token) {
          setBaseUrl(saved.hubUrl)
          setDeviceToken(saved.token)
          set({ ...empty, ...saved, hydrated: true })
          return
        }
      } catch { /* first run, or storage cleared */ }
      set({ hydrated: true })
    },

    pair: async (hubUrl, device) => {
      setBaseUrl(hubUrl)
      setDeviceToken(device.token)
      set({
        hubUrl,
        token: device.token,
        deviceId: device.deviceId,
        deviceName: device.name,
        pairedAt: new Date().toISOString(),
      })
      await persist()
    },

    unpair: async () => {
      setBaseUrl(null)
      setDeviceToken(null)
      set({ ...empty })
      await AsyncStorage.removeItem(KEY)
    },

    setDefaultCounter: async (id) => {
      set({ defaultCounterId: id })
      await persist()
    },
  }
})
