import Constants from 'expo-constants'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { ApiError, OfflineError, api } from '../src/api/client'
import { Banner } from '../src/components/Banner'
import { Button } from '../src/components/Button'
import { Screen } from '../src/components/Screen'
import { Text } from '../src/components/Text'
import { useCatalog } from '../src/store/catalog'
import { useDevice } from '../src/store/device'
import { color, radius, space, touch } from '../src/theme/tokens'

const metroHost = () => Constants.expoConfig?.hostUri?.split(':')[0] ?? null

/** A routable LAN address, as opposed to loopback or Expo's placeholder. */
const isLanAddress = (host: string | null): host is string =>
  !!host && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)

/**
 * Dev convenience only — in production the installer types the shop's IP.
 *
 * On an Android emulator `localhost` means the emulator, not the Mac, which is
 * the address everyone gets wrong once. `expo start` runs `adb reverse` for
 * Metro and we add one for the hub port, so 127.0.0.1 is correct over adb —
 * emulator or USB device alike. On wifi the Metro host IS the dev machine.
 */
function devHostGuess(): string {
  if (!__DEV__) return '192.168.1.10'
  const host = metroHost()
  if (isLanAddress(host)) return host
  return Platform.OS === 'android' ? '127.0.0.1' : '192.168.1.10'
}

/**
 * W01 — pairing. Support does this once during installation; a waiter should
 * never see it. Manual IP entry is the fallback and, on a shop wifi with a
 * reserved DHCP address, usually all that is needed.
 */
export default function Pair() {
  const router = useRouter()
  const pair = useDevice((s) => s.pair)
  const loadCatalog = useCatalog((s) => s.load)
  const { reason } = useLocalSearchParams<{ reason?: string }>()
  const [ip, setIp] = useState(devHostGuess())
  const [port, setPort] = useState('4000')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = async () => {
    setError(null)
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code shown on the counter PC under Devices.')
      return
    }
    setBusy(true)
    const url = `http://${ip.trim()}:${port.trim()}`
    try {
      if (!(await api.health(url))) {
        setError(`No answer from ${url}. Check the tablet is on the shop wifi and the counter PC is running.`)
        return
      }
      const device = await api.pairDevice(url, code.trim(), name.trim())
      await pair(url, device)
      try { await loadCatalog() } catch { /* Home will retry and show the error */ }
      router.replace('/home')
    } catch (e) {
      setError(
        e instanceof OfflineError ? `No answer from ${url}.`
        : e instanceof ApiError ? e.message
        : 'Pairing failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Text variant="title">Pair this Tablet</Text>
          <Text variant="body" muted>
            On the counter PC open Devices → Pair a tablet, then enter the address and code it shows.
          </Text>

          {reason === 'unpaired' && !error ? (
            <Banner tone="warning" message="This tablet was unpaired from the counter. Pair it again to keep taking orders." />
          ) : null}
          {error ? <Banner tone="danger" message={error} /> : null}

          <View style={styles.row}>
            <View style={styles.field}>
              <Text variant="label" muted>Hub IP</Text>
              <TextInput
                value={ip}
                onChangeText={setIp}
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
                style={styles.input}
                placeholderTextColor={color.textFaint}
              />
            </View>
            <View style={styles.fieldNarrow}>
              <Text variant="label" muted>Port</Text>
              <TextInput
                value={port}
                onChangeText={setPort}
                keyboardType="number-pad"
                style={styles.input}
                placeholderTextColor={color.textFaint}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.fieldNarrow}>
              <Text variant="label" muted>Pairing code</Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                placeholder="000000"
                style={[styles.input, styles.code]}
                placeholderTextColor={color.textFaint}
              />
            </View>
            <View style={styles.field}>
              <Text variant="label" muted>Name this tablet</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Tablet 1"
                style={styles.input}
                placeholderTextColor={color.textFaint}
              />
            </View>
          </View>

          {__DEV__ ? (
            <View style={styles.chips}>
              {[metroHost(), '127.0.0.1', '10.0.2.2'].filter((h): h is string => !!h).map((h) => (
                <Pressable key={h} onPress={() => setIp(h)} style={styles.chip}>
                  <Text variant="caption" muted>{h}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Button label={busy ? 'Connecting…' : 'Connect'} loading={busy} onPress={connect} />
          <Text variant="caption" faint style={styles.hint}>
            The code works once and expires after ten minutes.
          </Text>
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: {
    width: '100%', maxWidth: 720, gap: space.base,
    backgroundColor: color.surface, borderRadius: radius.modal,
    borderWidth: 1, borderColor: color.border, padding: space.xl,
  },
  row: { flexDirection: 'row', gap: space.md },
  field: { flex: 3, gap: space.xs },
  fieldNarrow: { flex: 1, gap: space.xs },
  input: {
    minHeight: touch.comfortable,
    backgroundColor: color.surfaceAlt,
    borderRadius: radius.input,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.base,
    color: color.text, fontSize: 17,
  },
  hint: { textAlign: 'center' },
  code: { fontSize: 24, letterSpacing: 6, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md,
    borderRadius: radius.button, borderWidth: 1, borderColor: color.border,
  },
})
