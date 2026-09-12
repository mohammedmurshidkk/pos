import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { api } from '../src/api/client'
import type { Order } from '../src/api/types'
import { Button } from '../src/components/Button'
import { Screen } from '../src/components/Screen'
import { StatusPill } from '../src/components/StatusPill'
import { Text } from '../src/components/Text'
import { useCart } from '../src/store/cart'
import { useCatalog } from '../src/store/catalog'
import { color, radius, space, touch } from '../src/theme/tokens'

/**
 * W04 — the two-parties-on-one-table case. A table holds many open orders, so
 * tapping an occupied table asks which one, or starts another.
 */
export default function TableOrders() {
  const router = useRouter()
  const { tableId, name } = useLocalSearchParams<{ tableId: string; name: string }>()
  const { money, employee } = useCatalog()
  const start = useCart((s) => s.start)
  const [orders, setOrders] = useState<Order[]>([])

  useEffect(() => {
    void api.openOrders()
      .then((all) => setOrders(all.filter((o) => o.tableId === tableId && o.status !== 'settled')))
      .catch(() => setOrders([]))
  }, [tableId])

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text variant="body" muted>‹ Back</Text>
        </Pressable>
        <Text variant="heading">Table {name}</Text>
        <Text variant="body" muted>{orders.length} open order{orders.length === 1 ? '' : 's'}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {orders.map((o) => (
          <Pressable
            key={o.id}
            onPress={() => router.push({ pathname: '/order', params: { id: o.id } })}
            style={styles.card}
          >
            <View style={styles.cardLeft}>
              <View style={styles.titleRow}>
                <Text variant="body">Order #{o.orderNo}</Text>
                {o.ticketLabel ? (
                  <View style={styles.label}><Text variant="caption" muted>{o.ticketLabel}</Text></View>
                ) : null}
              </View>
              <Text variant="caption" muted>
                {employee(o.waiterId)} · {o.lines.filter((l) => l.status !== 'void').length} items
              </Text>
            </View>
            <View style={styles.cardRight}>
              <Text variant="money" style={styles.total}>{money(o.total)}</Text>
              <StatusPill
                label={o.status === 'billed' ? 'Bill Printed' : 'Open'}
                tone={o.status === 'billed' ? 'info' : 'warning'}
              />
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="+ New Order on this Table"
          onPress={() => {
            start({ type: 'dine_in', tableId: tableId!, tableName: name ?? null })
            router.replace('/menu')
          }}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.base, paddingVertical: space.md },
  back: { minHeight: touch.min, justifyContent: 'center' },
  list: { padding: space.base, gap: space.md },
  card: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    minHeight: 88, padding: space.base,
    backgroundColor: color.surfaceAlt, borderRadius: radius.card,
    borderWidth: 1, borderColor: color.border, borderLeftWidth: 4, borderLeftColor: color.primary,
  },
  cardLeft: { gap: space.xs },
  cardRight: { alignItems: 'flex-end', gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { backgroundColor: color.surface, borderRadius: radius.input, paddingHorizontal: space.sm, paddingVertical: 2 },
  total: { fontSize: 20 },
  footer: { padding: space.base },
})
