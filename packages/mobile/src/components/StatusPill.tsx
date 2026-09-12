import { StyleSheet, View } from 'react-native'
import { color, radius, space } from '../theme/tokens'
import { Text } from './Text'

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'primary'

/**
 * Status always carries a word, never just a colour — cheap POS panels shift
 * colour badly off-axis and some staff are colour-blind.
 */
export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <View style={[styles.pill, { backgroundColor: `${tones[tone]}26` }]}>
      <Text variant="caption" style={[styles.text, { color: tones[tone] }]}>{label}</Text>
    </View>
  )
}

const tones = {
  success: color.success,
  warning: color.warning,
  danger: color.danger,
  info: color.info,
  primary: color.primary,
} as const

const styles = StyleSheet.create({
  pill: { borderRadius: radius.input, paddingHorizontal: space.sm, paddingVertical: 3, alignSelf: 'flex-start' },
  text: { fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
})
