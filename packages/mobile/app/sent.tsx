import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Screen } from '../src/components/Screen'
import { Text } from '../src/components/Text'
import { color, space } from '../src/theme/tokens'

/**
 * Confirmation after a send. It names the person who was picked, so a mis-tap
 * in the employee picker is caught in the second it happens.
 */
export default function Sent() {
  const router = useRouter()
  const { by, suppressed, queued } = useLocalSearchParams<{ by: string; suppressed: string; queued?: string }>()

  useEffect(() => {
    const t = setTimeout(() => router.replace('/home'), 1600)
    return () => clearTimeout(t)
  }, [router])

  const noKot = suppressed === 'true'
  const isQueued = queued === 'true'
  return (
    <Screen>
      <View style={styles.wrap}>
        <View
          style={[
            styles.badge,
            { backgroundColor: isQueued ? color.info : noKot ? color.warning : color.success },
          ]}
        >
          <Text variant="title" style={{ color: '#fff' }}>{isQueued ? '⇅' : '✓'}</Text>
        </View>
        <Text variant="title">
          {isQueued ? 'Queued' : noKot ? 'Saved without KOT' : 'Sent to kitchen'}
        </Text>
        <Text variant="body" muted>by {by}</Text>
        {isQueued ? (
          <Text variant="body" tone="info">
            The counter is unreachable. It will send automatically.
          </Text>
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.base },
  badge: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
})
