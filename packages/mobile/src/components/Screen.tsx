import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { color } from '../theme/tokens'

/** Every screen sits on the same ground colour, inside the safe area. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  body: { flex: 1 },
})
