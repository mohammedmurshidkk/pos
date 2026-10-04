import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import type { CartLine } from '../store/cart'
import { cartLineTotal } from '../store/cart'
import { color, space, touch } from '../theme/tokens'
import { QtyStepper } from './QtyStepper'
import { Text } from './Text'

interface Props {
  lines: CartLine[]
  money: (minor: number) => string
  onQty: (key: string, qty: number) => void
  /** Opens the note editor for a line that is already in the cart. */
  onNote?: (line: CartLine) => void
}

/**
 * The cart's contents, with no chrome of its own — rendered pinned to the right
 * on a landscape tablet and inside a bottom sheet on a phone, so the two never
 * drift apart.
 */
export function CartPanel({ lines, money, onQty, onNote }: Props) {
  if (lines.length === 0) {
    return <Text variant="body" faint style={styles.empty}>Tap an item to start.</Text>
  }
  return (
    <ScrollView contentContainerStyle={styles.list}>
      {lines.map((l) => (
        <View key={l.key} style={styles.line}>
          <View style={styles.top}>
            <Text variant="body" style={styles.name} numberOfLines={2}>{l.name}</Text>
            <Text variant="money">{money(cartLineTotal(l))}</Text>
          </View>
          {l.note ? <Text variant="caption" muted>{l.note}</Text> : null}
          <View style={styles.actions}>
            <QtyStepper qty={l.qty} onChange={(q) => onQty(l.key, q)} />
            {onNote ? (
              <Pressable onPress={() => onNote(l)} style={styles.noteBtn} hitSlop={8}>
                <Text variant="caption" style={{ color: color.primary }}>{l.note ? 'Edit note' : '+ Note'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  list: { gap: space.md, paddingVertical: space.md },
  line: { gap: space.sm, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: color.border },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  name: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  noteBtn: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.sm },
  empty: { padding: space.lg },
})
