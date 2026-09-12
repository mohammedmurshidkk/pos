import { ActivityIndicator, Pressable, StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native'
import { color, font, radius, touch } from '../theme/tokens'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface Props {
  label: string
  onPress: () => void
  variant?: Variant
  disabled?: boolean
  loading?: boolean
  flex?: number
  style?: ViewStyle
  testID?: string
}

/** Variant styling kept out of StyleSheet.create so it stays indexable and typed. */
const variants: Record<Variant, { container: ViewStyle; text: TextStyle }> = {
  primary: {
    container: { backgroundColor: color.primary },
    text: { color: color.onPrimary },
  },
  secondary: {
    container: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.borderStrong },
    text: { color: color.text },
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    text: { color: color.textMuted },
  },
  danger: {
    container: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.danger },
    text: { color: color.danger },
  },
}

/**
 * One primary button per screen. Waiter-app buttons are full or half width and
 * never shorter than 64px — they get tapped one-handed, mid-service.
 */
export function Button({ label, onPress, variant = 'primary', disabled, loading, flex, style, testID }: Props) {
  const v = variants[variant]
  const off = disabled === true || loading === true
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        v.container,
        flex != null && { flex },
        pressed && !off && styles.pressed,
        off && styles.disabled,
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={v.text.color} />
        : <Text style={[font.body, styles.label, v.text]}>{label}</Text>}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.comfortable,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  label: { fontWeight: '600' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
})
