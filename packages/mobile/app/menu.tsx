import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import type { Item } from '../src/api/types'
import { Button } from '../src/components/Button'
import { CartPanel } from '../src/components/CartPanel'
import { ItemTile } from '../src/components/ItemTile'
import { ModifierSheet } from '../src/components/ModifierSheet'
import { QtyStepper } from '../src/components/QtyStepper'
import { Screen } from '../src/components/Screen'
import { Sheet } from '../src/components/Sheet'
import { Text } from '../src/components/Text'
import { useCart, type CartLine } from '../src/store/cart'
import { useCatalog } from '../src/store/catalog'
import { tileWidth, useLayout } from '../src/theme/layout'
import { color, orderTypeColor, orderTypeLabel, radius, space, touch } from '../src/theme/tokens'

/**
 * W06 — menu and cart, the most-used screen in the app.
 *
 * Three fixed columns in landscape: category rail, item grid, cart. The cart is
 * never a bottom sheet on a tablet — the waiter reads it back to the customer
 * while still adding items.
 */
export default function Menu() {
  const router = useRouter()
  const { data, money } = useCatalog()
  const itemsIn = useCatalog((s) => s.itemsIn)
  const groupsForItem = useCatalog((s) => s.groupsForItem)
  const modifiersIn = useCatalog((s) => s.modifiersIn)
  const { draft, add, setQty, setNote, subtotal, count } = useCart()

  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [noteFor, setNoteFor] = useState<Item | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noteQty, setNoteQty] = useState(1)
  const [modifierFor, setModifierFor] = useState<Item | null>(null)
  // A line already in the cart whose note is being edited. Long-press only
  // works before an item is added; this is the way back to it afterwards.
  const [lineNote, setLineNote] = useState<CartLine | null>(null)
  const [lineNoteText, setLineNoteText] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const layout = useLayout()

  const categories = useMemo(
    () => [...(data?.categories ?? [])].sort((a, b) => a.sort - b.sort),
    [data],
  )

  // `data` must be in the deps: itemsIn is a stable reference, so without it
  // the grid would stay empty after the catalog finishes loading.
  const items = useMemo(() => {
    const list = itemsIn(categoryId)
    if (!query.trim()) return list
    const q = query.toLowerCase()
    return list.filter((i) => i.name.toLowerCase().includes(q))
  }, [data, categoryId, itemsIn, query])

  // Grid padding is space.md either side; gaps are space.md between columns.
  const gridAvailable = layout.width
    - (layout.isCompact ? 0 : 220)          // category rail
    - (layout.isExpanded ? 320 : 0)         // pinned cart
    - space.md * 2
  const itemW = tileWidth(gridAvailable, layout.itemColumns, space.md)

  /** An item with modifier groups must be configured before it can be added. */
  const tapItem = (item: Item) => {
    if (groupsForItem(item.id).length > 0) setModifierFor(item)
    else add(item)
  }

  const openNote = (item: Item) => {
    setNoteFor(item)
    setNoteText('')
    setNoteQty(1)
  }

  const openLineNote = (line: CartLine) => {
    // On a phone the cart is itself a sheet; close it so the two don't stack.
    setCartOpen(false)
    setLineNote(line)
    setLineNoteText(line.note ?? '')
  }

  const saveLineNote = () => {
    if (lineNote) setNote(lineNote.key, lineNoteText.trim() || null)
    setLineNote(null)
  }

  const confirmNote = () => {
    if (noteFor) add(noteFor, noteQty, noteText.trim() || null)
    setNoteFor(null)
  }

  return (
    <Screen>
      <View style={[styles.header, layout.isShort && styles.headerShort]}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text variant="body" muted>‹ Back</Text>
        </Pressable>
        <Text variant="heading">
          {draft.tableName ?? draft.vehicleNo ?? draft.customerName ?? orderTypeLabel[draft.type]}
        </Text>
        <View style={[styles.chip, { backgroundColor: `${orderTypeColor[draft.type]}26` }]}>
          <Text variant="caption" style={{ color: orderTypeColor[draft.type] }}>
            {orderTypeLabel[draft.type]}
          </Text>
        </View>
        {draft.ticketLabel ? (
          <View style={styles.labelChip}><Text variant="caption" muted>{draft.ticketLabel}</Text></View>
        ) : null}
      </View>

      <View style={styles.body}>
        {!layout.isCompact ? (
          <ScrollView style={styles.rail} contentContainerStyle={styles.railInner}>
            <Pressable
              onPress={() => setCategoryId(null)}
              style={[styles.railBtn, categoryId === null && styles.railActive]}
            >
              <Text variant="body" muted={categoryId !== null}>All</Text>
            </Pressable>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCategoryId(c.id)}
                style={[styles.railBtn, categoryId === c.id && styles.railActive]}
              >
                <Text variant="body" muted={categoryId !== c.id} numberOfLines={1}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.center}>
          {layout.isCompact ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroll}
              contentContainerStyle={styles.chips}
            >
              <Pressable onPress={() => setCategoryId(null)} style={[styles.chipBtn, categoryId === null && styles.railActive]}>
                <Text variant="body" muted={categoryId !== null}>All</Text>
              </Pressable>
              {categories.map((c) => (
                <Pressable key={c.id} onPress={() => setCategoryId(c.id)} style={[styles.chipBtn, categoryId === c.id && styles.railActive]}>
                  <Text variant="body" muted={categoryId !== c.id}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search items"
            placeholderTextColor={color.textFaint}
            style={styles.search}
          />
          <ScrollView contentContainerStyle={styles.grid}>
            {items.map((i) => (
              <ItemTile
                key={i.id}
                style={{ width: itemW }}
                name={i.name}
                price={money(i.price)}
                available={i.isAvailable}
                onPress={() => tapItem(i)}
                onLongPress={() => openNote(i)}
              />
            ))}
            {items.length === 0 ? <Text variant="body" muted style={styles.empty}>No items match.</Text> : null}
          </ScrollView>
        </View>

        {layout.isExpanded ? (
          <View style={styles.cart}>
            <Text variant="heading">Current Order</Text>
            <Text variant="caption" muted>{count()} items</Text>
            <CartPanel lines={draft.lines} money={money} onQty={setQty} onNote={openLineNote} />
            <View style={styles.totals}>
              <Text variant="body" muted>Total</Text>
              <Text variant="moneyLarge">{money(subtotal())}</Text>
            </View>
            <Button
              label={`Send to Kitchen · ${count()} item${count() === 1 ? '' : 's'}`}
              disabled={draft.lines.length === 0}
              onPress={() => router.push('/review')}
            />
          </View>
        ) : null}
      </View>

      {!layout.isExpanded ? (
        <View style={[styles.bottomBar, layout.isShort && styles.bottomBarShort]}>
          <Pressable onPress={() => setCartOpen(true)} style={styles.cartSummary}>
            <Text variant="body">{count()} item{count() === 1 ? '' : 's'}</Text>
            <Text variant="money">{money(subtotal())}</Text>
          </Pressable>
          <Button
            label="Send to Kitchen"
            flex={1}
            disabled={draft.lines.length === 0}
            onPress={() => router.push('/review')}
          />
        </View>
      ) : null}

      <Sheet
        visible={cartOpen}
        title="Current Order"
        subtitle={`${count()} items · ${money(subtotal())}`}
        onClose={() => setCartOpen(false)}
        cancelLabel="Close"
      >
        <CartPanel lines={draft.lines} money={money} onQty={setQty} onNote={openLineNote} />
      </Sheet>

      <ModifierSheet
        item={modifierFor}
        groups={modifierFor ? groupsForItem(modifierFor.id) : []}
        modifiersIn={modifiersIn}
        money={money}
        onAdd={(q, n, mods) => {
          if (modifierFor) add(modifierFor, q, n, mods)
          setModifierFor(null)
        }}
        onClose={() => setModifierFor(null)}
      />

      <Sheet
        visible={lineNote != null}
        title={lineNote?.name ?? ''}
        subtitle={lineNote ? `Qty ${lineNote.qty}` : undefined}
        onClose={() => setLineNote(null)}
      >
        <Text variant="label" muted>Note</Text>
        <TextInput
          value={lineNoteText}
          onChangeText={setLineNoteText}
          placeholder="no ice, less spicy…"
          placeholderTextColor={color.textFaint}
          multiline
          autoFocus
          style={styles.noteInput}
        />
        <View style={styles.noteRow}>
          {['No ice', 'Less spicy', 'No onion', 'Extra hot'].map((q) => (
            <Pressable key={q} onPress={() => setLineNoteText(q)} style={styles.quickNote}>
              <Text variant="caption" muted>{q}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.noteFooter}>
          {lineNote?.note ? (
            <Button label="Remove note" variant="secondary" onPress={() => { setLineNoteText(''); if (lineNote) setNote(lineNote.key, null); setLineNote(null) }} />
          ) : null}
          <Button label="Save note" flex={1} onPress={saveLineNote} />
        </View>
      </Sheet>

      <Sheet
        visible={noteFor != null}
        title={noteFor?.name ?? ''}
        subtitle={noteFor ? money(noteFor.price) : undefined}
        onClose={() => setNoteFor(null)}
      >
        <Text variant="label" muted>Note</Text>
        <TextInput
          value={noteText}
          onChangeText={setNoteText}
          placeholder="no ice, less spicy…"
          placeholderTextColor={color.textFaint}
          multiline
          style={styles.noteInput}
        />
        <View style={styles.noteRow}>
          {['No ice', 'Less spicy', 'No onion', 'Extra hot'].map((q) => (
            <Pressable key={q} onPress={() => setNoteText(q)} style={styles.quickNote}>
              <Text variant="caption" muted>{q}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.noteFooter}>
          <QtyStepper qty={noteQty} onChange={(q) => setNoteQty(Math.max(1, q))} />
          <Button label="Add to Order" flex={1} onPress={confirmNote} />
        </View>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.base, paddingVertical: space.md,
  },
  // A phone in landscape has ~390dp of height; header + bottom bar would
  // otherwise leave barely one row of items visible.
  headerShort: { paddingVertical: space.xs },
  back: { minHeight: touch.min, justifyContent: 'center', paddingRight: space.sm },
  chip: { borderRadius: radius.input, paddingHorizontal: space.sm, paddingVertical: 4 },
  labelChip: {
    borderRadius: radius.input, paddingHorizontal: space.sm, paddingVertical: 4,
    backgroundColor: color.surfaceAlt,
  },
  body: { flex: 1, flexDirection: 'row' },
  // flexBasis + no grow/shrink: a bare `width` on a ScrollView inside a row
  // container is treated as a hint and gets overridden by content sizing.
  rail: {
    flexBasis: 220, flexGrow: 0, flexShrink: 0, width: 220,
    borderRightWidth: 1, borderRightColor: color.border,
  },
  railInner: { gap: space.sm, padding: space.md },
  railBtn: {
    minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.base,
    borderRadius: radius.card, backgroundColor: color.surfaceAlt,
  },
  railActive: { backgroundColor: color.primary },
  center: { flex: 1, minWidth: 0, padding: space.md, gap: space.md },
  search: {
    minHeight: touch.min, backgroundColor: color.surfaceAlt, borderRadius: radius.input,
    borderWidth: 1, borderColor: color.border, paddingHorizontal: space.base,
    color: color.text, fontSize: 17,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingBottom: space.md },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.base, borderTopWidth: 1, borderTopColor: color.border,
    backgroundColor: color.surface,
  },
  bottomBarShort: { padding: space.sm },
  cartSummary: {
    minHeight: touch.comfortable, justifyContent: 'center', paddingHorizontal: space.base,
    borderRadius: radius.button, borderWidth: 1, borderColor: color.border, minWidth: 120,
  },
  // A horizontal ScrollView stretches its children to the cross axis, so it
  // needs an explicit height — otherwise the chips grow to fill the screen.
  chipsScroll: { flexGrow: 0, height: touch.min },
  chips: { gap: space.sm, alignItems: 'center' },
  chipBtn: {
    height: touch.min, justifyContent: 'center', paddingHorizontal: space.base,
    borderRadius: radius.button, backgroundColor: color.surfaceAlt,
  },
  cart: {
    width: 320, backgroundColor: color.surface,
    borderLeftWidth: 1, borderLeftColor: color.border,
    padding: space.base, gap: space.sm,
  },
  totals: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: { padding: space.lg },
  noteInput: {
    minHeight: 96, backgroundColor: color.surfaceAlt, borderRadius: radius.card,
    borderWidth: 1, borderColor: color.border, padding: space.base,
    color: color.text, fontSize: 17, textAlignVertical: 'top',
  },
  noteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  quickNote: {
    minHeight: 48, justifyContent: 'center', paddingHorizontal: space.base,
    borderRadius: radius.button, borderWidth: 1, borderColor: color.border,
  },
  noteFooter: { flexDirection: 'row', alignItems: 'center', gap: space.md },
})
