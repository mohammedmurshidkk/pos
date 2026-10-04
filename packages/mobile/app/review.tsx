import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { api, ApiError, OfflineError } from '../src/api/client'
import { newBatchRef } from '../src/util/ids'
import type { Employee } from '../src/api/types'
import { Banner } from '../src/components/Banner'
import { Button } from '../src/components/Button'
import { EmployeePicker } from '../src/components/EmployeePicker'
import { Screen } from '../src/components/Screen'
import { Text } from '../src/components/Text'
import { cartLineTotal, useCart } from '../src/store/cart'
import { useQueue } from '../src/store/queue'
import { useCatalog } from '../src/store/catalog'
import { color, radius, space, touch } from '../src/theme/tokens'

/**
 * W08 — review before sending. Lines are grouped by kitchen so the waiter sees
 * the split that is about to print, and a wrong category is caught here rather
 * than by a confused cook.
 */
export default function Review() {
  const router = useRouter()
  const { data, money } = useCatalog()
  const { draft, clear } = useCart()
  const enqueue = useQueue((s) => s.enqueue)

  const [picking, setPicking] = useState<null | { suppressKot: boolean }>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmNoKot, setConfirmNoKot] = useState(false)

  /** Mirrors the hub's routing so the preview matches the paper exactly. */
  const groups = useMemo(() => {
    const byKitchen = new Map<string, { name: string; lines: typeof draft.lines }>()
    for (const line of draft.lines) {
      const item = data?.items.find((i) => i.id === line.itemId)
      const cat = data?.categories.find((c) => c.id === item?.categoryId)
      const kitchenId = cat?.kitchenId ?? 'default'
      const name = cat?.kitchenId ? cat.name : 'Main Kitchen'
      const g = byKitchen.get(kitchenId) ?? { name, lines: [] }
      g.lines.push(line)
      byKitchen.set(kitchenId, g)
    }
    return [...byKitchen.values()]
  }, [data, draft.lines])

  const isAddOn = draft.orderId != null

  const send = async (employee: Employee, suppressKot: boolean) => {
    setPicking(null)
    setBusy(true)
    setError(null)

    // One idempotent payload: it is what we send now and what we queue if the
    // counter is unreachable, so a retry can never duplicate the round.
    const payload = {
      batchRef: newBatchRef(),
      orderId: draft.orderId,
      type: draft.type,
      tableId: draft.tableId,
      // Takeaway and delivery have no table: the kitchen calls out the name.
      ticketLabel: draft.ticketLabel
        ?? (draft.type === 'takeaway' || draft.type === 'delivery' ? draft.customerName : null),
      vehicleNo: draft.vehicleNo,
      bayNo: draft.bayNo,
      phoneSnapshot: draft.phone,
      addressSnapshot: draft.address,
      customerName: draft.customerName,
      lines: draft.lines.map((l) => ({
        itemId: l.itemId, qty: l.qty, note: l.note, modifiers: l.modifiers,
      })),
      employeeId: employee.id,
      suppressKot,
    }

    try {
      await api.submit(payload)
      clear()
      router.replace({ pathname: '/sent', params: { by: employee.name, suppressed: String(suppressKot) } })
    } catch (e) {
      if (e instanceof OfflineError) {
        // Keep serving. The order goes out when the counter is back.
        await enqueue(payload)
        clear()
        router.replace({ pathname: '/sent', params: { by: employee.name, suppressed: String(suppressKot), queued: 'true' } })
        return
      }
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const total = draft.lines.reduce((a, l) => a + cartLineTotal(l), 0)

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text variant="body" muted>‹ Back</Text>
        </Pressable>
        <Text variant="heading">Review Order</Text>
        <Text variant="body" muted>{draft.tableName ?? draft.vehicleNo ?? ''}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {isAddOn ? (
          <Banner tone="warning" message="ADD-ON — these items print as a new kitchen ticket." />
        ) : null}
        {error ? <Banner tone="danger" message={error} /> : null}

        {groups.map((g) => (
          <View key={g.name} style={styles.card}>
            <Text variant="label" muted>{g.name}</Text>
            {g.lines.map((l) => (
              <View key={l.key} style={styles.line}>
                <Text variant="body">{l.qty} × {l.name}</Text>
                <Text variant="money">{money(cartLineTotal(l))}</Text>
              </View>
            ))}
            {g.lines.some((l) => l.note) ? (
              g.lines.filter((l) => l.note).map((l) => (
                <Text key={`${l.key}-n`} variant="caption" muted>· {l.note}</Text>
              ))
            ) : null}
          </View>
        ))}

        <Text variant="caption" muted style={styles.hint}>
          {groups.length} separate ticket{groups.length === 1 ? '' : 's'} will print.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text variant="body" muted>Total</Text>
          <Text variant="moneyLarge">{money(total)}</Text>
        </View>
        <View style={styles.actions}>
          <Button
            label="Send to Kitchen"
            flex={2}
            loading={busy}
            disabled={draft.lines.length === 0}
            onPress={() => setPicking({ suppressKot: false })}
          />
          <Button
            label="Save without KOT"
            variant="secondary"
            flex={1}
            disabled={busy || draft.lines.length === 0}
            onPress={() => setConfirmNoKot(true)}
          />
        </View>
      </View>

      <EmployeePicker
        visible={picking != null}
        employees={(data?.employees ?? []).filter((e) => !picking?.suppressKot || e.canSaveWithoutKot)}
        subtitle={`${draft.lines.length} items · ${money(total)}`}
        onPick={(e) => void send(e, picking?.suppressKot ?? false)}
        onCancel={() => setPicking(null)}
      />

      {confirmNoKot ? (
        <View style={styles.confirmWrap}>
          <View style={styles.confirm}>
            <Text variant="heading">Kitchen will NOT receive this order</Text>
            <Text variant="body" muted>
              It will only be added to the bill. Use this when the food has already been served.
            </Text>
            <View style={styles.actions}>
              <Button label="Cancel" variant="secondary" flex={1} onPress={() => setConfirmNoKot(false)} />
              <Button
                label="Save without KOT"
                flex={1}
                onPress={() => { setConfirmNoKot(false); setPicking({ suppressKot: true }) }}
              />
            </View>
          </View>
        </View>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.base, paddingVertical: space.md,
  },
  back: { minHeight: touch.min, justifyContent: 'center' },
  list: { padding: space.base, gap: space.md },
  card: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.card,
    borderWidth: 1, borderColor: color.border, padding: space.base, gap: space.sm,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  hint: { textAlign: 'center', paddingTop: space.sm },
  footer: {
    padding: space.base, gap: space.md,
    borderTopWidth: 1, borderTopColor: color.border, backgroundColor: color.surface,
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: space.md },
  confirmWrap: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: '#000000aa', alignItems: 'center', justifyContent: 'center', padding: space.xl,
  },
  confirm: {
    width: '100%', maxWidth: 560, gap: space.base,
    backgroundColor: color.surface, borderRadius: radius.modal,
    borderWidth: 1, borderColor: color.warning, padding: space.xl,
  },
})
