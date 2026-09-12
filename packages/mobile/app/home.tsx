import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { api, OfflineError } from '../src/api/client'
import type { Order } from '../src/api/types'
import { AreaTabs } from '../src/components/AreaTabs'
import { Banner } from '../src/components/Banner'
import { Button } from '../src/components/Button'
import { Screen } from '../src/components/Screen'
import { TableTile } from '../src/components/TableTile'
import { Text } from '../src/components/Text'
import { useCart } from '../src/store/cart'
import { useCatalog } from '../src/store/catalog'
import { useQueue } from '../src/store/queue'
import { useDevice } from '../src/store/device'
import { useLayout, tileWidth } from '../src/theme/layout'
import { color, orderTypeColor, radius, space, touch } from '../src/theme/tokens'

const minutesSince = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return `${mins} min`
}

/**
 * W03 — Home. The table grid IS the home screen: tapping a table is what
 * "dine-in" means, so there is no Dine-in button and nothing is two taps deep.
 */
export default function Home() {
  const router = useRouter()
  const { data, load, money } = useCatalog()
  const tablesIn = useCatalog((s) => s.tablesIn)
  const draft = useCart((s) => s.draft)
  const clearDraft = useCart((s) => s.clear)
  const start = useCart((s) => s.start)
  const hubUrl = useDevice((s) => s.hubUrl)
  const layout = useLayout()
  const queued = useQueue((s) => s.pending)
  const rejected = useQueue((s) => s.rejected)
  const drain = useQueue((s) => s.drain)
  const discardRejected = useQueue((s) => s.discardRejected)

  const [areaId, setAreaId] = useState<string | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [offline, setOffline] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<'tables' | 'orders'>('tables')

  const refresh = useCallback(async () => {
    try {
      if (!data) await load()
      setOrders(await api.openOrders())
      setOffline(false)
      void drain()
    } catch (e) {
      setOffline(e instanceof OfflineError)
    }
  }, [data, load, drain])

  useFocusEffect(useCallback(() => { void refresh() }, [refresh]))

  const areas = useMemo(() => [...(data?.areas ?? [])].sort((a, b) => a.sort - b.sort), [data])
  const activeArea = areaId ?? areas[0]?.id ?? null
  const tables = activeArea ? tablesIn(activeArea) : []

  /** Table status is derived from open orders, never stored — a stored flag desyncs. */
  const ordersFor = useCallback(
    (tableId: string) => orders.filter((o) => o.tableId === tableId && o.status !== 'settled'),
    [orders],
  )

  const openTable = (tableId: string, name: string) => {
    const existing = ordersFor(tableId)
    if (existing.length > 0) {
      router.push({ pathname: '/table-orders', params: { tableId, name } })
      return
    }
    start({ type: 'dine_in', tableId, tableName: name })
    router.push('/menu')
  }

  const startType = (type: 'takeaway' | 'car' | 'delivery') => {
    start({ type })
    router.push('/capture')
  }

  const hasDraft = draft.lines.length > 0 && !draft.orderId
  // Grid padding is space.base either side, gaps are space.md between columns.
  const tileW = tileWidth(layout.width - space.base * 2, layout.tableColumns, space.md)

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="heading">{data?.settings.businessName ?? 'POS'}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: offline ? color.danger : color.success }]} />
          <Text variant="caption" muted>{offline ? 'Reconnecting…' : 'Connected'}</Text>
          <Pressable onLongPress={() => router.push('/settings')} delayLongPress={1500} style={styles.settingsHit}>
            <Text variant="caption" faint>{hubUrl?.replace('http://', '') ?? ''}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.segment}>
        {(['tables', 'orders'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.segmentBtn, tab === t && styles.segmentActive]}>
            <Text variant="body" muted={tab !== t}>
              {t === 'tables' ? 'Tables' : `Open Orders${orders.length ? ` (${orders.length})` : ''}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {offline ? (
        <View style={styles.bannerWrap}>
          <Banner tone="danger" message="Can't reach the counter. Orders can't be sent.">
            <Button label="Retry" variant="secondary" onPress={() => void refresh()} />
          </Banner>
        </View>
      ) : null}

      {queued.length > 0 ? (
        <View style={styles.bannerWrap}>
          <Banner
            tone="info"
            message={`${queued.length} order${queued.length === 1 ? '' : 's'} waiting to send`}
          >
            <Button label="Send now" variant="secondary" onPress={() => void drain()} />
          </Banner>
        </View>
      ) : null}

      {rejected.length > 0 ? (
        <View style={styles.bannerWrap}>
          <Banner
            tone="danger"
            message={`${rejected.length} order${rejected.length === 1 ? '' : 's'} rejected: ${rejected[0]?.error ?? ''}`}
          >
            <Button label="Discard" variant="ghost" onPress={() => void discardRejected()} />
          </Banner>
        </View>
      ) : null}

      {hasDraft ? (
        <View style={styles.bannerWrap}>
          <Banner
            tone="warning"
            message={`Unsent order${draft.tableName ? ` for ${draft.tableName}` : ''} · ${draft.lines.length} items`}
          >
            <Button label="Resume" variant="secondary" onPress={() => router.push('/menu')} />
            <Button label="Discard" variant="ghost" onPress={clearDraft} />
          </Banner>
        </View>
      ) : null}

      {tab === 'tables' ? (
        <>
          <AreaTabs items={areas} selectedId={activeArea} onSelect={setAreaId} />
          <ScrollView
            contentContainerStyle={styles.grid}
            refreshControl={<RefreshControl refreshing={refreshing} tintColor={color.primary} onRefresh={async () => {
              setRefreshing(true); await refresh(); setRefreshing(false)
            }} />}
          >
            {tables.length === 0 ? (
              <Text variant="body" muted style={styles.empty}>No tables in this area.</Text>
            ) : tables.map((t) => {
              const open = ordersFor(t.id)
              const billed = open.some((o) => o.status === 'billed')
              const total = open.reduce((a, o) => a + o.total, 0)
              return (
                <TableTile
                  key={t.id}
                  style={{ width: tileW }}
                  name={t.name}
                  seats={t.seats}
                  state={open.length === 0 ? 'free' : billed ? 'billed' : 'occupied'}
                  orderCount={open.length}
                  elapsed={open[0] ? minutesSince(open[0].openedAt) : null}
                  total={open.length ? money(total) : null}
                  onPress={() => openTable(t.id, t.name)}
                />
              )
            })}
          </ScrollView>
        </>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {orders.length === 0 ? (
            <Text variant="body" muted style={styles.empty}>No open orders.</Text>
          ) : orders.map((o) => (
            <Pressable
              key={o.id}
              onPress={() => router.push({ pathname: '/order', params: { id: o.id } })}
              style={[styles.orderRow, { borderLeftColor: orderTypeColor[o.type] }]}
            >
              <View style={styles.orderLeft}>
                <Text variant="body">#{o.orderNo}{o.ticketLabel ? ` · ${o.ticketLabel}` : ''}</Text>
                <Text variant="caption" muted>{minutesSince(o.openedAt)} · {o.lines.filter((l) => l.status !== 'void').length} items</Text>
              </View>
              <Text variant="money">{money(o.total)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View style={styles.bottomBar}>
        {(['takeaway', 'car', 'delivery'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => startType(t)}
            style={({ pressed }) => [styles.typeBtn, { borderColor: orderTypeColor[t] }, pressed && styles.pressed]}
          >
            <Text variant="body" style={{ color: orderTypeColor[t] }}>
              {t === 'takeaway' ? 'Takeaway' : t === 'car' ? 'Car' : 'Delivery'}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.base, paddingVertical: space.md,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  settingsHit: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.sm },
  segment: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.base, paddingBottom: space.sm },
  segmentBtn: {
    minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.lg,
    borderRadius: radius.button, backgroundColor: color.surface,
  },
  segmentActive: { backgroundColor: color.primary },
  bannerWrap: { paddingHorizontal: space.base, paddingBottom: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, padding: space.base },
  list: { gap: space.md, padding: space.base },
  empty: { padding: space.xl },
  orderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, borderRadius: radius.card,
    borderWidth: 1, borderColor: color.border, borderLeftWidth: 4,
    padding: space.base, minHeight: 88,
  },
  orderLeft: { gap: 2 },
  bottomBar: { flexDirection: 'row', gap: space.md, padding: space.base },
  typeBtn: {
    flex: 1, minHeight: touch.comfortable, borderRadius: radius.button,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
})
