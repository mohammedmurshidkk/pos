import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { api, setBaseUrl } from '../src/api/client'
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
  const [ip, setIp] = useState(devHostGuess())
  const [port, setPort] = useState('4000')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = async () => {
    setBusy(true)
    setError(null)
    const url = `http://${ip.trim()}:${port.trim()}`
    const reachable = await api.ping(url)
    if (!reachable) {
      setBusy(false)
      setError(`No answer from ${url}. Check the tablet is on the shop wifi and the counter PC is running.`)
      return
    }
    setBaseUrl(url)
    await pair(url)
    try { await loadCatalog() } catch { /* Home will retry and show the error */ }
    setBusy(false)
    router.replace('/home')
  }

  return (
    <Screen>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Text variant="title">Pair this Tablet</Text>
          <Text variant="body" muted>
            Enter the address shown on the counter PC, under Device Pairing.
          </Text>

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
            Ask your manager if you do not have the address.
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md,
    borderRadius: radius.button, borderWidth: 1, borderColor: color.border,
  },
})
