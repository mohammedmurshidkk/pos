import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { api, ApiError, OfflineError } from '../src/api/client'
import type { Employee, Order } from '../src/api/types'
import { Banner } from '../src/components/Banner'
import { Button } from '../src/components/Button'
import { EmployeePicker } from '../src/components/EmployeePicker'
import { Screen } from '../src/components/Screen'
import { Text } from '../src/components/Text'
import { useCatalog } from '../src/store/catalog'
import { useDevice } from '../src/store/device'
import { color, radius, space, touch } from '../src/theme/tokens'

/**
 * W10 — print the customer's bill.
 *
 * No payment UI: the waiter never takes money. The counter selector is
 * preselected to this device's default and changing it makes the change stick,
 * because in practice a tablet always prints to the same till.
 */
export default function Bill() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, money } = useCatalog()
  const { defaultCounterId, setDefaultCounter } = useDevice()

  const [order, setOrder] = useState<Order | null>(null)
  const [counterId, setCounterId] = useState<string | null>(defaultCounterId)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void api.order(id!).then(setOrder).catch(() => {}) }, [id])
  // The remembered counter is checked against the live list, not just used when
  // empty. A tablet paired before the counter was renumbered keeps a dead id in
  // AsyncStorage, and counter_id is a foreign key — the bill fails at the moment
  // the customer is waiting for it, with nothing on screen to explain why.
  useEffect(() => {
    if (!data) return
    if (!counterId || !data.counters.some((c) => c.id === counterId)) {
      setCounterId(data.counters[0]?.id ?? null)
    }
  }, [counterId, data])

  const print = async (employee: Employee) => {
    setPicking(false)
    setBusy(true)
    setError(null)
    try {
      await api.printBill(id!, employee.id, counterId!)
      if (counterId && counterId !== defaultCounterId) await setDefaultCounter(counterId)
      router.replace('/home')
    } catch (e) {
      setError(
        e instanceof OfflineError ? "Can't reach the counter. The bill has not printed."
        : e instanceof ApiError ? e.message
        : 'Something went wrong.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Text variant="title">Print Bill</Text>
          <Text variant="body" muted>Order #{order?.orderNo ?? '…'}</Text>

          {error ? <Banner tone="danger" message={error} /> : null}
          {order && order.reprintCount > 0 ? (
            <Banner
              tone="warning"
              message={`This bill has printed before. It will print as REPRINT #${order.reprintCount + 1}.`}
            />
          ) : null}

          {order ? (
            <View style={styles.totals}>
              <Row label="Subtotal" value={money(order.subtotal)} />
              {order.discountAmount > 0 ? <Row label="Discount" value={`-${money(order.discountAmount)}`} danger /> : null}
              <Row label={data?.settings.taxName ?? 'VAT'} value={money(order.taxAmount)} />
              <View style={styles.divider} />
              <View style={styles.totalRow}>
                <Text variant="body">TOTAL</Text>
                <Text variant="moneyLarge" tone="primary">
                  {data?.settings.currencyDisplay} {money(order.total)}
                </Text>
              </View>
            </View>
          ) : null}

          <Text variant="label" muted>Print at counter</Text>
          <View style={styles.counters}>
            {(data?.counters ?? []).map((c) => {
              const active = c.id === counterId
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCounterId(c.id)}
                  style={[styles.counter, active && styles.counterActive]}
                >
                  <Text variant="body" muted={!active}>{active ? `✓ ${c.name}` : c.name}</Text>
                </Pressable>
              )
            })}
          </View>
          <Text variant="caption" faint>Your default. Change it and it will be remembered.</Text>
          <Text variant="caption" muted>Payment is collected at the counter.</Text>

          <View style={styles.actions}>
            <Button label="Cancel" variant="secondary" flex={1} onPress={() => router.back()} />
            <Button
              label="Print Bill"
              flex={1}
              loading={busy}
              disabled={!order || !counterId}
              onPress={() => setPicking(true)}
            />
          </View>
        </View>
      </View>

      <EmployeePicker
        visible={picking}
        employees={data?.employees ?? []}
        subtitle={order ? `Order #${order.orderNo} · ${money(order.total)}` : undefined}
        onPick={(e) => void print(e)}
        onCancel={() => setPicking(false)}
      />
    </Screen>
  )
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant="body" muted>{label}</Text>
      <Text variant="money" tone={danger ? 'danger' : 'default'}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: {
    width: '100%', maxWidth: 560, gap: space.md,
    backgroundColor: color.surface, borderRadius: radius.modal,
    borderWidth: 1, borderColor: color.border, padding: space.xl,
  },
  totals: { gap: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  divider: { height: 1, backgroundColor: color.border, marginVertical: space.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  counters: { flexDirection: 'row', gap: space.md },
  counter: {
    flex: 1, minHeight: touch.comfortable, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.button, borderWidth: 1, borderColor: color.border,
    backgroundColor: color.surfaceAlt,
  },
  counterActive: { borderColor: color.primary, backgroundColor: color.primarySubtle },
  actions: { flexDirection: 'row', gap: space.md, paddingTop: space.sm },
})
