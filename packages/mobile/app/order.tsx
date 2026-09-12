import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { api } from '../src/api/client'
import type { Order } from '../src/api/types'
import { Button } from '../src/components/Button'
import { Screen } from '../src/components/Screen'
import { StatusPill } from '../src/components/StatusPill'
import { Text } from '../src/components/Text'
import { useCart } from '../src/store/cart'
import { useCatalog } from '../src/store/catalog'
import { color, orderTypeColor, orderTypeLabel, radius, space, touch } from '../src/theme/tokens'

/**
 * W09 — an open order.
 *
 * Sent lines are read-only: there is no void control anywhere on the tablet,
 * which removes the order-food-then-void theft vector. The waiter walks to the
 * counter instead, and the cashier — who is logged in — does it.
 */
export default function OrderScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { money, employee } = useCatalog()
  const start = useCart((s) => s.start)
  const attachOrder = useCart((s) => s.attachOrder)
  const [order, setOrder] = useState<Order | null>(null)

  const load = useCallback(async () => {
    try { setOrder(await api.order(id!)) } catch { /* Home shows the offline state */ }
  }, [id])

  useEffect(() => { void load() }, [load])

  if (!order) {
    return <Screen><View style={styles.center}><Text variant="body" muted>Loading…</Text></View></Screen>
  }

  const live = order.lines.filter((l) => l.status !== 'void')

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text variant="body" muted>‹ Back</Text>
        </Pressable>
        <Text variant="heading">Order #{order.orderNo}</Text>
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryLeft}>
          <View style={[styles.chip, { backgroundColor: `${orderTypeColor[order.type]}26` }]}>
            <Text variant="caption" style={{ color: orderTypeColor[order.type] }}>
              {orderTypeLabel[order.type]}
            </Text>
          </View>
          <Text variant="caption" muted>Opened by {employee(order.waiterId)}</Text>
        </View>
        <View style={styles.summaryRight}>
          <Text variant="moneyLarge">{money(order.total)}</Text>
          {order.status === 'billed'
            ? <StatusPill label="Bill Printed" tone="info" />
            : <StatusPill label="Open" tone="warning" />}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {live.map((l) => (
          <View key={l.id} style={styles.line}>
            <Text variant="body" tone="success">✓</Text>
            <Text variant="body" style={styles.qty}>{l.qty}</Text>
            <View style={styles.lineBody}>
              <Text variant="body">{l.nameSnapshot}</Text>
              {l.note ? <Text variant="caption" muted>{l.note}</Text> : null}
              {l.createdBy !== order.waiterId ? (
                <Text variant="caption" faint>added by {employee(l.createdBy)}</Text>
              ) : null}
            </View>
            <Text variant="money">{money(l.qty * l.unitPriceSnapshot)}</Text>
          </View>
        ))}
        <Text variant="caption" muted style={styles.hint}>
          To cancel an item, ask the cashier.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Change Table" variant="secondary" flex={1}
          onPress={() => router.push({ pathname: '/change-table', params: { id: order.id } })} />
        <Button label="Print Bill" variant="secondary" flex={1}
          onPress={() => router.push({ pathname: '/bill', params: { id: order.id } })} />
        <Button label="Add Items" flex={2} onPress={() => {
          start({
            type: order.type, tableId: order.tableId, tableName: null,
            ticketLabel: order.ticketLabel, vehicleNo: order.vehicleNo,
          })
          attachOrder(order.id)
          router.push('/menu')
        }} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.base, paddingVertical: space.md },
  back: { minHeight: touch.min, justifyContent: 'center' },
  summary: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    margin: space.base, padding: space.base,
    backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border,
  },
  summaryLeft: { gap: space.xs },
  summaryRight: { alignItems: 'flex-end', gap: space.xs },
  chip: { alignSelf: 'flex-start', borderRadius: radius.input, paddingHorizontal: space.sm, paddingVertical: 4 },
  list: { paddingHorizontal: space.base, gap: space.sm, paddingBottom: space.lg },
  line: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64,
    backgroundColor: color.surfaceAlt, borderRadius: radius.card,
    borderWidth: 1, borderColor: color.border, padding: space.base, opacity: 0.9,
  },
  qty: { minWidth: 24, textAlign: 'center' },
  lineBody: { flex: 1, gap: 2 },
  hint: { textAlign: 'center', paddingTop: space.md },
  footer: { flexDirection: 'row', gap: space.md, padding: space.base },
})
