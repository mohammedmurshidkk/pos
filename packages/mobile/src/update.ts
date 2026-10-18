import Constants from 'expo-constants'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { Platform } from 'react-native'
import { getBaseUrl, getDeviceToken } from './api/client'

/**
 * Tablet updates come from the counter PC, not the internet: the counter keeps
 * the APK of its own version (desktop/src/updates.ts) and serves it at
 * /api/app-update/apk. So a tablet never runs ahead of the hub it talks to, and
 * a shop wifi without internet is fine.
 */

export interface ReleaseNote {
  version: string
  date: string | null
  sections: { title: string; items: string[] }[]
}

/** GET /api/app-update — server/src/services/app-update.ts. */
export type AppUpdate =
  | { available: false; hubVersion: string | null; version?: string; notes?: ReleaseNote[] }
  | { available: true; hubVersion: string | null; version: string; size: number; notes: ReleaseNote[] }

/** The version this APK was built as (app.config.js). */
export const appVersion = (): string => String(Constants.expoConfig?.version ?? '0.0.0')

/**
 * Download the APK from the counter and hand it to Android's installer, which
 * asks the waiter to confirm (and, the first time, to allow this app to install
 * apps). The app is replaced in place: pairing and queued orders are kept.
 */
export async function downloadAndInstall(onProgress: (fraction: number) => void): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Updates install on Android tablets only.')
  const base = getBaseUrl()
  const token = getDeviceToken()
  if (!base || !token) throw new Error("Can't reach the counter")

  const target = `${FileSystem.cacheDirectory}update.apk`
  await FileSystem.deleteAsync(target, { idempotent: true })
  const download = FileSystem.createDownloadResumable(
    `${base}/api/app-update/apk`,
    target,
    { headers: { 'x-device-token': token } },
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (totalBytesExpectedToWrite > 0) onProgress(totalBytesWritten / totalBytesExpectedToWrite)
    },
  )
  const result = await download.downloadAsync()
  if (!result || result.status !== 200) throw new Error('The counter could not send the update. Try again.')

  const contentUri = await FileSystem.getContentUriAsync(result.uri)
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    // FLAG_GRANT_READ_URI_PERMISSION: the installer reads the file through our provider.
    flags: 1,
  })
}
