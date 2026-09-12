import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { color, radius, space } from '../theme/tokens'
import { Text } from './Text'

interface Props {
  name: string
  price: string
  available: boolean
  onPress: () => void
  onLongPress?: () => void
  /** Computed by the grid so columns align exactly. */
  style?: ViewStyle
}

/** Long-press opens the note sheet — a plain item still needs "no ice". */
export function ItemTile({ name, price, available, onPress, onLongPress, style }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={available ? name : `${name}, unavailable`}
      disabled={!available}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [styles.tile, style, !available && styles.off, pressed && available && styles.pressed]}
    >
      <Text variant="body" numberOfLines={2} style={styles.name}>{name}</Text>
      {available ? (
        <Text variant="money" tone="primary">{price}</Text>
      ) : (
        <View style={styles.pill}><Text variant="caption" tone="danger">Unavailable</Text></View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tile: {
    minHeight: 96,
    backgroundColor: color.surfaceAlt,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.md,
    justifyContent: 'space-between',
  },
  off: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  name: { flexShrink: 1 },
  pill: { alignSelf: 'flex-start' },
})
