import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import type { Order, OrderType } from '../api/types'
import { Banner, Button, EmptyState, Modal } from '../components/ui'
import { useStore } from '../store'

type TableState = 'free' | 'occupied' | 'billed'

const stateColor: Record<TableState, string> = {
  free: 'var(--success)', occupied: 'var(--warning)', billed: 'var(--info)',
}
const stateLabel: Record<TableState, string> = {
  free: 'Free', occupied: 'Occupied', billed: 'Bill printed',
}
const typeLabel: Record<OrderType, string> = {
  dine_in: 'Dine-in', takeaway: 'Takeaway', car: 'Car', delivery: 'Delivery',
}
const typeColor: Record<OrderType, string> = {
  dine_in: 'var(--dine-in)', takeaway: 'var(--takeaway)', car: 'var(--car)', delivery: 'var(--delivery)',
}

const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
const elapsed = (iso: string) => {
  const m = minutesSince(iso)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/**
 * A05 — the floor at a glance, in the same tile language as the waiter app so
 * support can talk staff through either one.
 *
 * Table status is derived from open orders, never stored: a stored flag
 * desyncs. A table is "bill printed" only when every order on it has had its
 * bill printed, because one unbilled party still needs serving.
 */
export function Floor() {
  const { data, money } = useStore()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[]>([])
  const [areaId, setAreaId] = useState<string | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setOrders(await api.openOrders())
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { void refresh(); setTick((n) => n + 1) }, 5000)
    return () => clearInterval(t)
  }, [refresh])

  const areas = [...(data?.areas ?? [])].sort((a, b) => a.sort - b.sort)
  const tables = data?.tables ?? []
  const activeArea = areaId ?? areas[0]?.id ?? null

  const on = (tableId: string) => orders.filter((o) => o.tableId === tableId)
  const stateOf = (tableId: string): TableState => {
    const list = on(tableId)
    if (list.length === 0) return 'free'
    return list.every((o) => o.status === 'billed') ? 'billed' : 'occupied'
  }

  const counts = { free: 0, occupied: 0, billed: 0 }
  for (const t of tables) counts[stateOf(t.id)]++

  const inArea = tables.filter((t) => t.areaId === activeArea).sort((a, b) => a.sort - b.sort)
  const busyIn = (aid: string) => tables.filter((t) => t.areaId === aid && on(t.id).length > 0).length
  const offTable = orders.filter((o) => !o.tableId).sort((a, b) => a.openedAt.localeCompare(b.openedAt))

  // Same as the tablet's occupied-table sheet: pick the party, or seat a
  // second one on the same table.
  const openTable = (tableId: string) => {
    if (on(tableId).length === 0) navigate('/order/new', { state: { type: 'dine_in', tableId } })
    else setPicking(tableId)
  }

  const pickingTable = tables.find((t) => t.id === picking)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, height: '100%', minHeight: 0 }}>
      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <h2>Floor</h2>
          <span className="muted" style={{ display: 'flex', gap: 14, fontSize: 13 }}>
            {(['free', 'occupied', 'billed'] as const).map((st) => (
              <span key={st} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: stateColor[st] }} />
                {stateLabel[st]} {counts[st]}
              </span>
            ))}
          </span>
        </div>
        {error ? <Banner tone="danger">{error}</Banner> : null}

        {areas.length > 1 ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {areas.map((a) => {
              const n = busyIn(a.id)
              return (
                <button key={a.id} onClick={() => setAreaId(a.id)} style={chip(a.id === activeArea)}>
                  {a.name}{n ? ` · ${n}` : ''}
                </button>
              )
            })}
          </div>
        ) : null}

        <div style={{
          overflow: 'auto', display: 'grid', gap: 10, alignContent: 'start',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        }}>
          {inArea.length === 0 ? (
            <EmptyState title="No tables in this area" hint="Add tables under Setup → Tables." />
          ) : inArea.map((t) => {
            const list = on(t.id)
            const st = stateOf(t.id)
            const oldest = list.reduce<string | null>((m, o) => (!m || o.openedAt < m ? o.openedAt : m), null)
            const total = list.reduce((a, o) => a + o.total, 0)
            return (
              <button
                key={t.id}
                onClick={() => openTable(t.id)}
                aria-label={`Table ${t.name}, ${stateLabel[st]}`}
                style={{
                  minHeight: 112, padding: 12, textAlign: 'left', cursor: 'pointer',
                  borderRadius: 'var(--r-card)', border: '1px solid var(--border)',
                  borderLeft: `4px solid ${stateColor[st]}`, background: 'var(--surface)',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6,
                }}
              >
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 700 }}>{t.name}</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {list.length > 1 ? (
                      <span style={{
                        minWidth: 22, height: 22, borderRadius: 11, padding: '0 6px', fontSize: 12, fontWeight: 700,
                        background: 'var(--primary)', color: 'white', display: 'grid', placeItems: 'center',
                      }}>{list.length}</span>
                    ) : null}
                    <span className="faint" style={{ fontSize: 12 }}>{t.seats} seats</span>
                  </span>
                </span>
                {st === 'free' ? (
                  <span style={{ color: stateColor.free, fontWeight: 600, fontSize: 13 }}>Free</span>
                ) : (
                  <span style={{ display: 'grid', gap: 2 }}>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {list.length > 1 ? `${list.length} orders · ` : ''}{oldest ? elapsed(oldest) : ''}
                    </span>
                    <span className="money" style={{ textAlign: 'left', fontWeight: 600 }}>{money(total)}</span>
                    <span style={{ color: stateColor[st], fontWeight: 600, fontSize: 12, textTransform: 'uppercase' }}>
                      {stateLabel[st]}
                    </span>
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <h2>Takeaway, car, delivery</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {(['takeaway', 'car', 'delivery'] as const).map((ty) => (
            <Button key={ty} onClick={() => navigate('/order/new', { state: { type: ty } })}>
              {typeLabel[ty]}
            </Button>
          ))}
        </div>
        <div style={{ overflow: 'auto', display: 'grid', gap: 8, alignContent: 'start' }}>
          {offTable.length === 0 ? <EmptyState title="None open" /> : offTable.map((o) => (
            <button
              key={o.id}
              onClick={() => navigate('/billing', { state: { orderId: o.id } })}
              style={{
                textAlign: 'left', cursor: 'pointer', padding: 10, borderRadius: 'var(--r-card)',
                border: '1px solid var(--border)', borderLeft: `4px solid ${typeColor[o.type]}`,
                background: 'var(--surface)', display: 'flex', justifyContent: 'space-between', gap: 8,
              }}
            >
              <span style={{ display: 'grid', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>
                  #{o.orderNo} · {o.vehicleNo ?? o.customerName ?? o.ticketLabel ?? o.phoneSnapshot ?? typeLabel[o.type]}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>{typeLabel[o.type]} · {elapsed(o.openedAt)}</span>
              </span>
              <span style={{ display: 'grid', justifyItems: 'end', gap: 2 }}>
                <span className="money">{money(o.total)}</span>
                {o.status === 'billed' ? <span style={{ color: 'var(--info)', fontSize: 12, fontWeight: 600 }}>BILL PRINTED</span> : null}
              </span>
            </button>
          ))}
        </div>
      </section>

      {pickingTable ? (
        <Modal title={`Table ${pickingTable.name}`} subtitle={on(pickingTable.id).length === 1 ? '1 open order' : `${on(pickingTable.id).length} open orders`} onClose={() => setPicking(null)} width={480}>
          <div style={{ display: 'grid', gap: 8 }}>
            {on(pickingTable.id).map((o) => (
              <button
                key={o.id}
                onClick={() => navigate('/billing', { state: { orderId: o.id } })}
                style={{
                  textAlign: 'left', cursor: 'pointer', padding: 12, borderRadius: 'var(--r-card)',
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  display: 'flex', justifyContent: 'space-between', gap: 12,
                }}
              >
                <span style={{ display: 'grid', gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>#{o.orderNo}{o.ticketLabel ? ` · ${o.ticketLabel}` : ''}</span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {elapsed(o.openedAt)} · {o.lines.filter((l) => l.status !== 'void').length} items
                  </span>
                </span>
                <span style={{ display: 'grid', justifyItems: 'end', gap: 2 }}>
                  <span className="money">{money(o.total)}</span>
                  {o.status === 'billed' ? <span style={{ color: 'var(--info)', fontSize: 12, fontWeight: 600 }}>BILL PRINTED</span> : null}
                </span>
              </button>
            ))}
          </div>
          <Button variant="primary" onClick={() => navigate('/order/new', { state: { type: 'dine_in', tableId: pickingTable.id } })}>
            + New order on this table
          </Button>
        </Modal>
      ) : null}
    </div>
  )
}

const chip = (active: boolean): React.CSSProperties => ({
  height: 32, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600,
  border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
  background: active ? 'var(--primary-subtle)' : 'var(--surface)',
  color: active ? 'var(--primary)' : 'var(--text-muted)',
})
