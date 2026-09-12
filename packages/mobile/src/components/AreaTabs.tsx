import { Pressable, ScrollView, StyleSheet } from 'react-native'
import { color, space, touch } from '../theme/tokens'
import { Text } from './Text'

interface Props<T extends { id: string; name: string }> {
  items: T[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/** Underlined tabs — the selected one is marked by colour AND a rule. */
export function AreaTabs<T extends { id: string; name: string }>({ items, selectedId, onSelect }: Props<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {items.map((a) => {
        const active = a.id === selectedId
        return (
          <Pressable
            key={a.id}
            onPress={() => onSelect(a.id)}
            style={[styles.tab, active && styles.active]}
          >
            <Text variant="body" muted={!active}>{a.name}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  /**
   * A horizontal ScrollView inside a column flex parent stretches to fill the
   * cross axis unless its height is pinned — which left a tall empty band
   * above the table grid on a tablet.
   */
  scroll: { flexGrow: 0, height: touch.min },
  row: { gap: space.sm, paddingHorizontal: space.base, alignItems: 'center' },
  tab: {
    height: touch.min,
    justifyContent: 'center',
    paddingHorizontal: space.base,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  active: { borderBottomColor: color.primary },
})
