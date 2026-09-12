import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { api, ApiError, OfflineError } from '../src/api/client'
import type { Employee, Order } from '../src/api/types'
import { AreaTabs } from '../src/components/AreaTabs'
import { Banner } from '../src/components/Banner'
import { Button } from '../src/components/Button'
import { EmployeePicker } from '../src/components/EmployeePicker'
import { Screen } from '../src/components/Screen'
import { TableTile } from '../src/components/TableTile'
import { Text } from '../src/components/Text'
import { useCatalog } from '../src/store/catalog'
import { space } from '../src/theme/tokens'

/**
 * W13 — move an order to another table. Used more than you would expect:
 * guests get moved constantly. Only free tables are selectable.
 */
export default function ChangeTable() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data } = useCatalog()
  const tablesIn = useCatalog((s) => s.tablesIn)

  const [order, setOrder] = useState<Order | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [areaId, setAreaId] = useState<string | null>(null)
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const move = async (employee: Employee) => {
    if (!target) return
    try {
      await api.setTable(id!, target.id, employee.id)
      router.back()
    } catch (e) {
      setError(
        e instanceof OfflineError ? "Can't reach the counter. The order has not moved."
        : e instanceof ApiError ? e.message
        : 'Something went wrong.',
      )
    } finally {
      setTarget(null)
    }
  }

  useEffect(() => {
    void api.order(id!).then(setOrder).catch(() => {})
    void api.openOrders().then(setOrders).catch(() => {})
  }, [id])

  const areas = useMemo(() => [...(data?.areas ?? [])].sort((a, b) => a.sort - b.sort), [data])
  const activeArea = areaId ?? areas[0]?.id ?? null
  const tables = activeArea ? tablesIn(activeArea) : []
  const occupied = new Set(orders.filter((o) => o.status !== 'settled').map((o) => o.tableId))

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title">Move Order #{order?.orderNo ?? '…'}</Text>
        <Text variant="body" muted>Choose a free table.</Text>
        {error ? <Banner tone="danger" message={error} /> : null}
      </View>

      <AreaTabs items={areas} selectedId={activeArea} onSelect={setAreaId} />

      <ScrollView contentContainerStyle={styles.grid}>
        {tables.map((t) => {
          const isCurrent = t.id === order?.tableId
          const isBusy = occupied.has(t.id) && !isCurrent
          return (
            <TableTile
              key={t.id}
              name={t.name}
              seats={t.seats}
              state={isBusy ? 'occupied' : 'free'}
              current={isCurrent}
              disabled={isBusy || isCurrent}
              onPress={() => setTarget({ id: t.id, name: t.name })}
            />
          )
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </View>

      <EmployeePicker
        visible={target != null}
        employees={data?.employees ?? []}
        subtitle={target ? `Move to table ${target.name}` : undefined}
        onPick={(e) => void move(e)}
        onCancel={() => setTarget(null)}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { padding: space.base, gap: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, padding: space.base },
  footer: { padding: space.base },
})
