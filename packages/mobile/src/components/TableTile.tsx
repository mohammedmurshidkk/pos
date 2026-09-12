import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import { Text } from './Text'

export type TableState = 'free' | 'occupied' | 'billed'

interface Props {
  name: string
  seats: number
  state: TableState
  /** Shown as a badge when a table holds more than one party. */
  orderCount?: number
  elapsed?: string | null
  total?: string | null
  disabled?: boolean
  current?: boolean
  onPress: () => void
  /** Computed by the grid so columns align exactly. */
  style?: ViewStyle
}

const stateColor = { free: color.success, occupied: color.warning, billed: color.info } as const
const stateLabel = { free: 'Free', occupied: '', billed: 'Bill Printed' } as const

export function TableTile({
  name, seats, state, orderCount = 0, elapsed, total, disabled, current, onPress, style,
}: Props) {
  const accent = current ? color.primary : stateColor[state]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Table ${name}, ${current ? 'current' : state}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        style,
        { borderLeftColor: accent },
        current && styles.current,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={styles.top}>
        <Text variant="title">{name}</Text>
        <View style={styles.topRight}>
          {orderCount > 1 ? (
            <View style={styles.badge}>
              <Text variant="caption" style={styles.badgeText}>{orderCount}</Text>
            </View>
          ) : null}
          <Text variant="caption" faint>{seats}</Text>
        </View>
      </View>

      <View style={styles.bottom}>
        {current ? (
          <Text variant="caption" tone="primary">CURRENT</Text>
        ) : state === 'free' ? (
          <Text variant="caption" tone="success">{stateLabel.free}</Text>
        ) : (
          <>
            <Text variant="caption" muted>
              {orderCount > 1 ? `${orderCount} orders` : elapsed ?? ''}
            </Text>
            {total ? <Text variant="money">{total}</Text> : null}
            {state === 'billed' ? <Text variant="caption" tone="info">{stateLabel.billed}</Text> : null}
          </>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tile: {
    minHeight: touch.tile,
    backgroundColor: color.surfaceAlt,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.border,
    borderLeftWidth: 4,
    padding: space.md,
    justifyContent: 'space-between',
  },
  current: { backgroundColor: color.primarySubtle, borderColor: color.primary },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.75 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: {
    minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6,
    backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: color.onPrimary, fontWeight: '700' },
  bottom: { gap: 2 },
})
