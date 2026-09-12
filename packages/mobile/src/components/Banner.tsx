import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { color, radius, space } from '../theme/tokens'
import { Text } from './Text'

type Tone = 'warning' | 'danger' | 'info' | 'success'

/**
 * An inline strip, never a modal. A modal would stop service — the waiter must
 * be able to keep taking the order while the counter is unreachable.
 */
export function Banner({ tone, message, children }: { tone: Tone; message: string; children?: ReactNode }) {
  return (
    <View style={[styles.wrap, { borderColor: tones[tone], backgroundColor: `${tones[tone]}1a` }]}>
      <Text variant="body" tone={tone} style={styles.message}>{message}</Text>
      {children}
    </View>
  )
}

const tones = {
  warning: color.warning,
  danger: color.danger,
  info: color.info,
  success: color.success,
} as const

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
  },
  message: { flex: 1 },
})
