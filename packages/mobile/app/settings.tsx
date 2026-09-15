import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Constants from 'expo-constants'
import { api } from '../src/api/client'
import { Banner } from '../src/components/Banner'
import { Button } from '../src/components/Button'
import { Screen } from '../src/components/Screen'
import { Text } from '../src/components/Text'
import { useCatalog } from '../src/store/catalog'
import { useDevice } from '../src/store/device'
import { color, radius, space } from '../src/theme/tokens'

/**
 * W12 — device settings and diagnostics.
 *
 * Reached by long-pressing the address in the Home header: obscure enough that
 * waiters never wander in, findable by support over the phone. Without this a
 * changed router IP means uninstalling and reinstalling the APK on site.
 */
export default function DeviceSettings() {
  const router = useRouter()
  const { hubUrl, deviceName, pairedAt, unpair } = useDevice()
  const load = useCatalog((s) => s.load)
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [confirmUnpair, setConfirmUnpair] = useState(false)

  const test = async () => {
    setStatus('testing')
    // Checks the token too: an address that answers but no longer accepts this
    // tablet is not a working connection.
    try { await api.me(); setStatus('ok') } catch { setStatus('fail') }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title">Device Settings</Text>
        <Button label="Done" variant="ghost" onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {status === 'ok' ? <Banner tone="success" message="Counter reachable." /> : null}
        {status === 'fail' ? <Banner tone="danger" message="No answer from the counter. Check the wifi." /> : null}

        <View style={styles.card}>
          <Text variant="label" muted>Connection</Text>
          <Row label="Hub" value={hubUrl?.replace('http://', '') ?? 'not paired'} />
          <Row label="Paired" value={pairedAt ? new Date(pairedAt).toLocaleString('en-GB') : '—'} />
          <View style={styles.actions}>
            <Button label={status === 'testing' ? 'Testing…' : 'Test Connection'}
              variant="secondary" flex={1} onPress={() => void test()} />
            <Button label="Refresh Menu" variant="secondary" flex={1}
              onPress={() => { void load().catch(() => {}) }} />
          </View>
        </View>

        <View style={styles.card}>
          <Text variant="label" muted>Device</Text>
          <Row label="Name" value={deviceName} />
          <Row label="App version" value={String(Constants.expoConfig?.version ?? '1.0.0')} />
        </View>

        <View style={[styles.card, styles.danger]}>
          <Text variant="heading">Re-pair Device</Text>
          <Text variant="body" muted>
            Disconnects this tablet. A new address will have to be entered from the counter PC.
          </Text>
          {confirmUnpair ? (
            <View style={styles.actions}>
              <Button label="Cancel" variant="secondary" flex={1} onPress={() => setConfirmUnpair(false)} />
              <Button label="Confirm" variant="danger" flex={1}
                onPress={async () => { await unpair(); router.replace('/pair') }} />
            </View>
          ) : (
            <Button label="Re-pair Device" variant="danger" onPress={() => setConfirmUnpair(true)} />
          )}
        </View>
      </ScrollView>
    </Screen>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="body" muted>{label}</Text>
      <Text variant="body">{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.base },
  list: { padding: space.base, gap: space.md, maxWidth: 720, width: '100%', alignSelf: 'center' },
  card: {
    gap: space.sm, padding: space.base,
    backgroundColor: color.surface, borderRadius: radius.card,
    borderWidth: 1, borderColor: color.border,
  },
  danger: { borderColor: color.danger },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  actions: { flexDirection: 'row', gap: space.md, paddingTop: space.sm },
})
