import { Pressable, StyleSheet, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import { Text } from './Text'

/**
 * 56x56 buttons with a gap between them. Smaller or closer and a thumb hits
 * both, which silently changes an order.
 */
export function QtyStepper({ qty, onChange }: { qty: number; onChange: (next: number) => void }) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel="Decrease quantity"
        onPress={() => onChange(qty - 1)}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
      >
        <Text variant="title">−</Text>
      </Pressable>
      <Text variant="title" style={styles.qty}>{qty}</Text>
      <Pressable
        accessibilityLabel="Increase quantity"
        onPress={() => onChange(qty + 1)}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
      >
        <Text variant="title">+</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  btn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.button,
    backgroundColor: color.surfaceAlt,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  qty: { minWidth: 36, textAlign: 'center' },
})
