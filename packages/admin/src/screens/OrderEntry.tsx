import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import type { Customer, Item, Order, OrderType } from '../api/types'
import { CustomerFields } from '../components/CustomerFields'
import { Banner, Button, EmptyState, Field, Modal, inputStyle } from '../components/ui'
import { useStore } from '../store'

const TYPES: { id: OrderType; label: string; color: string }[] = [
  { id: 'dine_in', label: 'Dine-in', color: 'var(--dine-in)' },
  { id: 'takeaway', label: 'Takeaway', color: 'var(--takeaway)' },
  { id: 'car', label: 'Car', color: 'var(--car)' },
  { id: 'delivery', label: 'Delivery', color: 'var(--delivery)' },
]

interface CartLine {
  key: string
  item: Item
  qty: number
  note: string | null
  modifiers: { id: string; name: string; priceDelta: number }[]
}

const batchRef = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Take an order at the counter — the fallback for when a tablet is broken,
 * flat or lost, and the everyday path for walk-in takeaway.
 *
 * It sends exactly what the tablet sends (one idempotent submit: create, add,
 * send to kitchen), so KOT routing, licence checks and audit are the same code
 * path. `/order/new` starts an order; `/order/:id` adds a round to an open one.
 *
 * The counter is signed in, so whoever is at the till keys the order. The
 * waiter who serves it gets the sales credit and is chosen here, as on the
 * tablet's employee picker.
 */
export function OrderEntry() {
  const { id: existingId } = useParams()
  const navigate = useNavigate()
  const { data, operator, money } = useStore()
  // Opened from the floor view: a tapped table, or a Takeaway/Car/Delivery button.
  const start = (useLocation().state as { type?: OrderType; tableId?: string } | null) ?? {}

  const [existing, setExisting] = useState<Order | null>(null)
  const [type, setType] = useState<OrderType>(start.type ?? (start.tableId ? 'dine_in' : 'takeaway'))
  const [areaId, setAreaId] = useState<string | null>(null)
  const [tableId, setTableId] = useState<string | null>(start.tableId ?? null)
  const [ticketLabel, setTicketLabel] = useState('')
  const [vehicleNo, setVehicleNo] = useState('')
  const [bayNo, setBayNo] = useState('')
  const [phone, setPhone] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [known, setKnown] = useState<Customer | null>(null)
  const [address, setAddress] = useState('')
  const [waiterId, setWaiterId] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [picking, setPicking] = useState<Item | null>(null)
  const [openOrders, setOpenOrders] = useState<Order[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (existingId) {
      api.order(existingId).then(setExisting).catch(() => setError('Could not load that order.'))
    }
    api.openOrders().then(setOpenOrders).catch(() => { /* table badges are a nicety */ })
  }, [existingId])

  useEffect(() => {
    if (!waiterId && operator) setWaiterId(operator.id)
  }, [operator, waiterId])

  const areas = data?.areas ?? []
  const activeArea = areaId ?? data?.tables.find((t) => t.id === tableId)?.areaId ?? areas[0]?.id ?? null
  const categories = [...(data?.categories ?? [])].sort((a, b) => a.sort - b.sort)
  const activeCategory = categoryId ?? categories[0]?.id ?? null

  const items = useMemo(() => {
    const all = (data?.items ?? []).filter((i) => i.isAvailable)
    const q = search.trim().toLowerCase()
    if (q) return all.filter((i) => i.name.toLowerCase().includes(q))
    return all.filter((i) => i.categoryId === activeCategory).sort((a, b) => a.sort - b.sort)
  }, [data, search, activeCategory])

  const groupsFor = (itemId: string) => {
    const links = (data?.itemModifierGroups ?? []).filter((l) => l.itemId === itemId)
      .sort((a, b) => a.sort - b.sort)
    return links
      .map((l) => data?.modifierGroups.find((g) => g.id === l.groupId))
      .filter((g): g is NonNullable<typeof g> => g != null)
  }

  const addToCart = (item: Item, qty = 1, note: string | null = null, modifiers: CartLine['modifiers'] = []) => {
    setCart((c) => {
      const same = c.find((l) => l.item.id === item.id && !l.note && !note
        && l.modifiers.length === 0 && modifiers.length === 0)
      if (same) return c.map((l) => (l === same ? { ...l, qty: l.qty + qty } : l))
      return [...c, { key: batchRef(), item, qty, note, modifiers }]
    })
  }

  const tap = (item: Item) => {
    if (groupsFor(item.id).length > 0) setPicking(item)
    else addToCart(item)
  }

  const lineTotal = (l: CartLine) => l.qty * (l.item.price + l.modifiers.reduce((t, m) => t + m.priceDelta, 0))
  const cartTotal = cart.reduce((t, l) => t + lineTotal(l), 0)

  const detailsMissing = existing ? null
    : type === 'dine_in' && !tableId ? 'Pick a table.'
    : type === 'car' && !vehicleNo.trim() ? 'Enter the vehicle number.'
    : type === 'delivery' && (!phone.trim() || !address.trim()) ? 'Enter the phone number and address.'
    : null

  const send = async (suppressKot: boolean) => {
    if (!operator) return setError('Sign in at the counter first.')
    if (detailsMissing) return setError(detailsMissing)
    if (cart.length === 0) return setError('Add at least one item.')
    setBusy(true)
    setError(null)
    try {
      const res = await api.submitOrder({
        batchRef: batchRef(),
        orderId: existing?.id ?? null,
        type: existing?.type ?? type,
        tableId: type === 'dine_in' ? tableId : null,
        // Takeaway and delivery print the customer's name on the KOT so the
        // kitchen can call it out; a car is called by its number.
        ticketLabel: type === 'dine_in' ? ticketLabel.trim() || null
          : type === 'car' ? null : customerName.trim() || null,
        vehicleNo: type === 'car' ? vehicleNo.trim().toUpperCase() : null,
        bayNo: type === 'car' ? bayNo.trim() || null : null,
        phoneSnapshot: type === 'dine_in' ? null : phone.trim() || null,
        customerName: type === 'dine_in' ? null : customerName.trim() || null,
        addressSnapshot: type === 'delivery' ? address.trim() : null,
        lines: cart.map((l) => ({ itemId: l.item.id, qty: l.qty, note: l.note, modifiers: l.modifiers })),
        employeeId: operator.id,
        suppressKot,
      })
      const orderId = res.order?.id ?? existing?.id
      // The first KOT credits whoever sent it, which here is the cashier.
      // Hand the credit to the waiter who actually serves the table.
      if (orderId && !existing && waiterId && waiterId !== operator.id) {
        await api.setWaiter(orderId, waiterId, operator.id)
      }
      navigate('/billing', { state: { orderId } })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub. Nothing was sent.')
      setBusy(false)
    }
  }

  const tablesInArea = (data?.tables ?? []).filter((t) => t.areaId === activeArea).sort((a, b) => a.sort - b.sort)
  const ordersOn = (tid: string) => openOrders.filter((o) => o.tableId === tid).length
  const tableName = (tid: string | null) => data?.tables.find((t) => t.id === tid)?.name ?? ''

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 360px', gap: 16, height: '100%', minHeight: 0 }}>
      {/* ── order details ── */}
      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, overflow: 'auto' }}>
        {existing ? (
          <>
            <h2>Add to order #{existing.orderNo}</h2>
            <div className="muted">
              {TYPES.find((t) => t.id === existing.type)?.label}
              {existing.tableId ? ` · Table ${tableName(existing.tableId)}` : ''}
              {existing.ticketLabel ? ` · ${existing.ticketLabel}` : ''}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              Already on the order: {existing.lines.filter((l) => l.status !== 'void').length} item(s), {money(existing.total)}
            </div>
          </>
        ) : (
          <>
            <h2>New order</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  style={{
                    height: 44, borderRadius: 'var(--r-button)', cursor: 'pointer', fontWeight: 600,
                    border: `1px solid ${type === t.id ? t.color : 'var(--border)'}`,
                    background: type === t.id ? `color-mix(in srgb, ${t.color} 14%, transparent)` : 'var(--surface)',
                    color: type === t.id ? t.color : 'var(--text-muted)',
                  }}
                >{t.label}</button>
              ))}
            </div>

            {type === 'dine_in' ? (
              <>
                {areas.length > 1 ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {areas.map((a) => (
                      <button key={a.id} onClick={() => setAreaId(a.id)} style={chip(a.id === activeArea)}>{a.name}</button>
                    ))}
                  </div>
                ) : null}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {tablesInArea.map((t) => {
                    const n = ordersOn(t.id)
                    const on = t.id === tableId
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTableId(t.id)}
                        style={{
                          height: 52, borderRadius: 'var(--r-card)', cursor: 'pointer', fontWeight: 600,
                          border: `1px solid ${on ? 'var(--primary)' : n ? 'var(--warning)' : 'var(--border)'}`,
                          background: on ? 'var(--primary-subtle)' : 'var(--surface)',
                          color: on ? 'var(--primary)' : 'var(--text)', display: 'grid', placeItems: 'center',
                        }}
                      >
                        <span>{t.name}</span>
                        {n ? <span style={{ fontSize: 11, color: 'var(--warning)' }}>{n} open</span> : null}
                      </button>
                    )
                  })}
                </div>
                {tablesInArea.length === 0 ? <span className="muted">No tables in this area. Add them under Setup.</span> : null}
                <Field label="Label (optional)">
                  <input style={inputStyle} value={ticketLabel} placeholder="Blue shirt" onChange={(e) => setTicketLabel(e.target.value)} />
                </Field>
              </>
            ) : null}

            {type === 'takeaway' ? (
              <CustomerFields phone={phone} name={customerName} onPhone={setPhone} onName={setCustomerName} />
            ) : null}

            {type === 'car' ? (
              <>
                <Field label="Vehicle number">
                  <input style={inputStyle} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
                </Field>
                <Field label="Bay (optional)">
                  <input style={inputStyle} value={bayNo} onChange={(e) => setBayNo(e.target.value)} />
                </Field>
                <CustomerFields phone={phone} name={customerName} onPhone={setPhone} onName={setCustomerName} />
              </>
            ) : null}

            {type === 'delivery' ? (
              <>
                <CustomerFields
                  phone={phone} name={customerName} onPhone={setPhone} onName={setCustomerName}
                  autoFocus
                  onFound={(c) => {
                    setKnown(c)
                    // The address used last is the likeliest one this time.
                    if (c?.addresses[0]) setAddress((a) => a.trim() ? a : c.addresses[0]!)
                  }}
                />
                {known && known.addresses.length > 1 ? (
                  <div style={{ display: 'grid', gap: 4 }}>
                    <span className="label">Saved addresses</span>
                    {known.addresses.map((a) => (
                      <button key={a} onClick={() => setAddress(a)} style={{ ...chip(a === address.trim()), height: 'auto', minHeight: 32, padding: '6px 12px', textAlign: 'left', borderRadius: 'var(--r-button)' }}>
                        {a}
                      </button>
                    ))}
                  </div>
                ) : null}
                <Field label="Address">
                  <textarea
                    style={{ ...inputStyle, height: 80, padding: 8, resize: 'vertical' }}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </Field>
              </>
            ) : null}

            <Field label="Waiter (gets the sales credit)">
              <select style={inputStyle} value={waiterId} onChange={(e) => setWaiterId(e.target.value)}>
                {(data?.employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
          </>
        )}
      </section>

      {/* ── menu ── */}
      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <input
          autoFocus
          placeholder="Search the menu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, height: 44, fontSize: 16 }}
        />
        {!search ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setCategoryId(c.id)} style={chip(c.id === activeCategory)}>{c.name}</button>
            ))}
          </div>
        ) : null}
        <div style={{ overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, alignContent: 'start' }}>
          {items.length === 0 ? <EmptyState title="No items" hint={search ? 'Nothing matches that search.' : 'This category is empty.'} /> : items.map((i) => (
            <button
              key={i.id}
              onClick={() => tap(i)}
              style={{
                minHeight: 72, padding: 10, textAlign: 'left', cursor: 'pointer',
                borderRadius: 'var(--r-card)', border: '1px solid var(--border)', background: 'var(--surface)',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6,
              }}
            >
              <span style={{ fontWeight: 600 }}>{i.name}</span>
              <span className="money muted" style={{ textAlign: 'left' }}>{money(i.price)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── cart ── */}
      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <h2>{existing ? 'New round' : 'Order'}</h2>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <div style={{ flex: 1, overflow: 'auto', display: 'grid', gap: 8, alignContent: 'start' }}>
          {cart.length === 0 ? <EmptyState title="Nothing added yet" hint="Tap items on the menu." /> : cart.map((l) => (
            <div key={l.key} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{l.item.name}</span>
                <span className="money">{money(lineTotal(l))}</span>
              </div>
              {l.modifiers.length ? <span className="faint" style={{ fontSize: 13 }}>{l.modifiers.map((m) => m.name).join(' · ')}</span> : null}
              {l.note ? <span className="faint" style={{ fontSize: 13 }}>{l.note}</span> : null}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button style={step} onClick={() => setCart((c) => c.flatMap((x) => x.key !== l.key ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []))}>−</button>
                <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 600 }}>{l.qty}</span>
                <button style={step} onClick={() => setCart((c) => c.map((x) => x.key === l.key ? { ...x, qty: x.qty + 1 } : x))}>+</button>
                <Button variant="ghost" style={{ marginLeft: 'auto', minHeight: 32 }} onClick={() => {
                  const note = window.prompt('Note for the kitchen', l.note ?? '')
                  if (note !== null) setCart((c) => c.map((x) => x.key === l.key ? { ...x, note: note.trim() || null } : x))
                }}>Note</Button>
                <Button variant="ghost" style={{ minHeight: 32 }} onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span className="muted">{existing ? 'This round' : 'Items total'}</span>
          <span className="money" style={{ fontWeight: 600 }}>{money(cartTotal)}</span>
        </div>
        <Button variant="primary" disabled={busy || cart.length === 0} onClick={() => void send(false)}>
          Send to kitchen
        </Button>
        {operator?.canSaveWithoutKot ? (
          <Button disabled={busy || cart.length === 0} onClick={() => void send(true)}>Save without KOT</Button>
        ) : null}
        <Button variant="ghost" onClick={() => navigate('/billing', existing ? { state: { orderId: existing.id } } : undefined)}>Cancel</Button>
      </section>

      {picking ? (
        <ModifierModal
          item={picking}
          groups={groupsFor(picking.id)}
          onClose={() => setPicking(null)}
          onAdd={(qty, note, mods) => { addToCart(picking, qty, note, mods); setPicking(null) }}
        />
      ) : null}
    </div>
  )
}

/** Same rules as the tablet's modifier sheet: a required group must be filled before adding. */
function ModifierModal({ item, groups, onClose, onAdd }: {
  item: Item
  groups: { id: string; name: string; minSelect: number; maxSelect: number }[]
  onClose: () => void
  onAdd: (qty: number, note: string | null, mods: { id: string; name: string; priceDelta: number }[]) => void
}) {
  const { data, money } = useStore()
  const [chosen, setChosen] = useState<Record<string, string[]>>({})
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')

  const modsIn = (gid: string) => (data?.modifiers ?? []).filter((m) => m.groupId === gid).sort((a, b) => a.sort - b.sort)
  const toggle = (g: { id: string; maxSelect: number }, mid: string) => setChosen((prev) => {
    const cur = prev[g.id] ?? []
    if (cur.includes(mid)) return { ...prev, [g.id]: cur.filter((x) => x !== mid) }
    if (g.maxSelect <= 1) return { ...prev, [g.id]: [mid] }
    if (cur.length >= g.maxSelect) return prev
    return { ...prev, [g.id]: [...cur, mid] }
  })
  const ok = groups.every((g) => (chosen[g.id]?.length ?? 0) >= g.minSelect)
  const selected = groups.flatMap((g) => modsIn(g.id).filter((m) => chosen[g.id]?.includes(m.id)))
    .map((m) => ({ id: m.id, name: m.name, priceDelta: m.priceDelta }))

  return (
    <Modal title={item.name} subtitle={money(item.price)} onClose={onClose} width={560}>
      {groups.map((g) => (
        <div key={g.id} style={{ display: 'grid', gap: 6 }}>
          <span className="label">
            {g.name} {g.minSelect > 0 ? `· choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}` : g.maxSelect > 1 ? `· up to ${g.maxSelect}` : '· optional'}
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {modsIn(g.id).map((m) => (
              <button key={m.id} onClick={() => toggle(g, m.id)} style={chip(chosen[g.id]?.includes(m.id) ?? false)}>
                {m.name}{m.priceDelta ? ` +${money(m.priceDelta)}` : ''}
              </button>
            ))}
          </div>
        </div>
      ))}
      <Field label="Note">
        <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button style={step} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
        <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 600 }}>{qty}</span>
        <button style={step} onClick={() => setQty((q) => q + 1)}>+</button>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ok} onClick={() => onAdd(qty, note.trim() || null, selected)}>Add to order</Button>
        </span>
      </div>
    </Modal>
  )
}

const chip = (on: boolean): React.CSSProperties => ({
  height: 32, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600,
  border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
  background: on ? 'var(--primary-subtle)' : 'var(--surface)',
  color: on ? 'var(--primary)' : 'var(--text-muted)',
})
const step: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 'var(--r-button)', border: '1px solid var(--border-strong)',
  background: 'var(--surface)', cursor: 'pointer', fontWeight: 700,
}
