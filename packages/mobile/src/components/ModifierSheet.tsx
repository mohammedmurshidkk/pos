import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import type { Item, Modifier, ModifierGroup } from '../api/types'
import { color, radius, space, touch } from '../theme/tokens'
import { Button } from './Button'
import { QtyStepper } from './QtyStepper'
import { Sheet } from './Sheet'
import { Text } from './Text'

export interface ChosenModifier { id: string; name: string; priceDelta: number }

interface Props {
  item: Item | null
  groups: ModifierGroup[]
  modifiersIn: (groupId: string) => Modifier[]
  money: (minor: number) => string
  onAdd: (qty: number, note: string | null, modifiers: ChosenModifier[]) => void
  onClose: () => void
}

/**
 * W07a — modifier selection.
 *
 * Groups enforce their own min/max: `Add to Order` stays disabled until every
 * required group is satisfied, so an under-specified item can never reach the
 * kitchen and come back as a question.
 */
export function ModifierSheet({ item, groups, modifiersIn, money, onAdd, onClose }: Props) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({})
  const [note, setNote] = useState('')
  const [qty, setQty] = useState(1)

  const reset = () => { setChosen({}); setNote(''); setQty(1) }

  const toggle = (group: ModifierGroup, modifierId: string) => {
    setChosen((prev) => {
      const current = prev[group.id] ?? []
      if (current.includes(modifierId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== modifierId) }
      }
      // A single-select group replaces; a multi-select group fills to its cap.
      if (group.maxSelect <= 1) return { ...prev, [group.id]: [modifierId] }
      if (current.length >= group.maxSelect) return prev
      return { ...prev, [group.id]: [...current, modifierId] }
    })
  }

  const selected = useMemo<ChosenModifier[]>(() => {
    const out: ChosenModifier[] = []
    for (const g of groups) {
      for (const id of chosen[g.id] ?? []) {
        const m = modifiersIn(g.id).find((x) => x.id === id)
        if (m) out.push({ id: m.id, name: m.name, priceDelta: m.priceDelta })
      }
    }
    return out
  }, [chosen, groups, modifiersIn])

  const unmet = groups.filter((g) => (chosen[g.id]?.length ?? 0) < g.minSelect)
  const unit = (item?.price ?? 0) + selected.reduce((a, m) => a + m.priceDelta, 0)

  return (
    <Sheet
      visible={item != null}
      title={item?.name ?? ''}
      subtitle={item ? money(item.price) : undefined}
      onClose={() => { reset(); onClose() }}
    >
      <ScrollView contentContainerStyle={styles.body}>
        {groups.map((g) => {
          const picked = chosen[g.id] ?? []
          const hint = g.minSelect > 0 && g.maxSelect <= 1
            ? 'Choose 1'
            : g.maxSelect > 1 ? `Choose up to ${g.maxSelect}` : 'Optional'
          return (
            <View key={g.id} style={styles.group}>
              <View style={styles.groupHead}>
                <Text variant="label" muted>{g.name}</Text>
                <Text variant="caption" faint>{hint}</Text>
              </View>
              {modifiersIn(g.id).map((m) => {
                const on = picked.includes(m.id)
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => toggle(g, m.id)}
                    style={[styles.option, on && styles.optionOn]}
                  >
                    <Text variant="body">{on ? `✓  ${m.name}` : m.name}</Text>
                    <Text variant="money" muted={!on}>
                      {m.priceDelta === 0 ? '—' : `+${money(m.priceDelta)}`}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          )
        })}

        <View style={styles.group}>
          <Text variant="label" muted>Note</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="no onion, less spicy…"
            placeholderTextColor={color.textFaint}
            style={styles.note}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <QtyStepper qty={qty} onChange={(q) => setQty(Math.max(1, q))} />
        <Button
          label={unmet.length > 0 ? `Choose ${unmet[0]!.name}` : `Add to Order · ${money(unit * qty)}`}
          flex={1}
          disabled={unmet.length > 0}
          onPress={() => { onAdd(qty, note.trim() || null, selected); reset() }}
        />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.base, paddingBottom: space.sm },
  group: { gap: space.sm },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: touch.comfortable, paddingHorizontal: space.base,
    backgroundColor: color.surfaceAlt, borderRadius: radius.card,
    borderWidth: 1, borderColor: color.border,
  },
  optionOn: { borderColor: color.primary, backgroundColor: color.primarySubtle },
  note: {
    minHeight: touch.comfortable, backgroundColor: color.surfaceAlt,
    borderRadius: radius.input, borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.base, color: color.text, fontSize: 17,
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.md },
})
