import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import type { Employee } from '../api/types'
import { color, radius, space, touch } from '../theme/tokens'
import { Sheet } from './Sheet'
import { Text } from './Text'

interface Props {
  visible: boolean
  employees: Employee[]
  subtitle?: string
  onPick: (employee: Employee) => void
  onCancel: () => void
}

const initials = (name: string) =>
  name.split(' ').map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase()

/**
 * W-EMP — the app's only identity step. There is no login: identity is captured
 * at the moment a record is created, which is more reliable than a session
 * because a session can be left open by one waiter and used by another.
 *
 * Deliberately: no pre-selection and no confirm button. Pre-highlighting the
 * last person is how every order ends up logged against one waiter; and the
 * tap IS the confirmation, so a second tap would only add friction.
 */
export function EmployeePicker({ visible, employees, subtitle, onPick, onCancel }: Props) {
  return (
    <Sheet
      visible={visible}
      title="Who is taking this order?"
      subtitle={subtitle}
      onClose={onCancel}
      cancelLabel="Cancel"
    >
      <ScrollView contentContainerStyle={styles.grid} horizontal={false}>
        {employees.map((e) => (
          <Pressable
            key={e.id}
            accessibilityRole="button"
            accessibilityLabel={e.name}
            onPress={() => onPick(e)}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
          >
            <View style={styles.avatar}>
              <Text variant="heading" style={styles.initials}>{initials(e.name)}</Text>
            </View>
            <Text variant="body" numberOfLines={1}>{e.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    width: touch.tile,
    height: touch.tile,
    borderRadius: radius.card,
    backgroundColor: color.surfaceAlt,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  pressed: { opacity: 0.7 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center',
  },
  initials: { color: color.onPrimary },
})
