import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, api } from '../api/client'
import { Banner, Button, EmptyState, Field as FieldWrap, Modal, Pill, inputStyle } from '../components/ui'
import { MASTERS, type Field, type MasterSpec, type Row, specFor } from '../masters/config'
import { useStore } from '../store'
import { MenuImport } from './MenuImport'

type Lists = Record<string, Row[]>

/**
 * One screen for every master.
 *
 * Twelve hand-written CRUD screens would be twelve places to forget the audit
 * stamp or the referential guard; this renders from a field spec, so adding a
 * master is a config entry.
 */
export function Masters() {
  const { operator, data, load } = useStore()
  const [entity, setEntity] = useState('printers')
  const [rows, setRows] = useState<Row[]>([])
  const [lists, setLists] = useState<Lists>({})
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bulk, setBulk] = useState(false)
  const [importing, setImporting] = useState(false)

  const spec = specFor(entity)

  const refresh = useCallback(async (target: MasterSpec) => {
    try {
      const [main, ...refs] = await Promise.all([
        api.masters<Row>(target.entity),
        ...(target.needs ?? []).map((n) => api.masters<Row>(n)),
      ])
      setRows(main)
      const next: Lists = {}
      ;(target.needs ?? []).forEach((n, i) => { next[n] = refs[i] ?? [] })
      setLists(next)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [])

  useEffect(() => { void refresh(spec) }, [refresh, spec])

  const save = async (values: Record<string, unknown>, groupIds?: string[]) => {
    if (!operator) return setError('Sign in at the counter first.')
    try {
      let id: string | undefined
      if (editing === 'new') id = (await api.createMaster<Row>(entity, values, operator.id)).id
      else if (editing) id = (await api.updateMaster<Row>(entity, editing.id, values, operator.id)).id ?? editing.id
      if (id && groupIds) await api.setItemModifierGroups(id, groupIds, operator.id)
      setEditing(null)
      await refresh(spec)
      await load()   // the cashier screens read the menu from bootstrap
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    }
  }

  const runPrinterAction = async (fn: () => Promise<string>) => {
    try {
      setNotice(await fn())
      setError(null)
    } catch (e) {
      setNotice(null)
      setError(e instanceof ApiError ? e.message : 'Could not reach the printer.')
    }
  }

  const deactivate = async (row: Row) => {
    if (!operator) return setError('Sign in at the counter first.')
    try {
      await api.deactivateMaster(entity, row.id, operator.id)
      await refresh(spec)
      await load()
      setError(null)
    } catch (e) {
      // Guard messages are written to be acted on — show them verbatim.
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 20, minHeight: 0 }}>
      <nav style={{ display: 'grid', gap: 2, alignContent: 'start' }}>
        {MASTERS.map((m) => (
          <button
            key={m.entity}
            onClick={() => { setEntity(m.entity); setError(null); setNotice(null) }}
            style={{
              textAlign: 'left', height: 'var(--row-h)', padding: '0 12px', cursor: 'pointer',
              borderRadius: 'var(--r-button)', border: '1px solid transparent', fontWeight: 600,
              color: m.entity === entity ? 'var(--primary)' : 'var(--text-muted)',
              background: m.entity === entity ? 'var(--primary-subtle)' : 'transparent',
            }}
          >
            {m.title}
          </button>
        ))}
      </nav>

      <section style={{ display: 'grid', gap: 16, alignContent: 'start', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <h1>{spec.title}</h1>
            {spec.hint ? <div className="muted" style={{ marginTop: 4 }}>{spec.hint}</div> : null}
          </div>
          {entity === 'tables' ? <Button onClick={() => setBulk(true)}>Bulk add</Button> : null}
          {/* Printers used to have their own screen as well; Test print and
              requeueing tickets that gave up after five tries live here now. */}
          {entity === 'printers' ? (
            <Button onClick={() => void runPrinterAction(async () => {
              const { retried } = await api.retryJobs()
              return retried ? `${retried} failed ticket(s) sent to the printers again.` : 'No failed tickets to retry.'
            })}>Retry failed prints</Button>
          ) : null}
          {entity === 'categories' || entity === 'items'
            ? <Button onClick={() => setImporting(true)}>Import CSV</Button> : null}
          <Button variant="primary" onClick={() => setEditing('new')}>Add {spec.title.replace(/s$/, '')}</Button>
        </div>

        {error ? <Banner tone="danger">{error}</Banner> : null}
        {notice ? <Banner tone="success">{notice}</Banner> : null}

        <div className="card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {spec.fields.map((f) => (
                  <th key={f.key} style={thStyle(f)}>{f.label}</th>
                ))}
                <th style={{ ...thStyle(), width: 150, textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={spec.fields.length + 1}>
                  <EmptyState title={`No ${spec.title.toLowerCase()} yet`} hint="Add the first one above." />
                </td></tr>
              ) : rows.map((row) => {
                const off = row.active === false || row.enabled === false
                return (
                  <tr key={row.id} style={{
                    height: 'var(--row-h)', borderTop: '1px solid var(--border)', opacity: off ? 0.5 : 1,
                  }}>
                    {spec.fields.map((f) => (
                      <td key={f.key} style={tdStyle(f)}>{display(f, row, lists)}</td>
                    ))}
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {entity === 'printers' && !off ? (
                        <Button variant="ghost" onClick={() => void runPrinterAction(async () => {
                          await api.testPrint(row.id)
                          return `Test page sent to ${String(row.name)}.`
                        })}>Test print</Button>
                      ) : null}
                      <Button variant="ghost" onClick={() => setEditing(row)}>Edit</Button>
                      {!off ? (
                        <Button variant="ghost" onClick={() => void deactivate(row)}>Disable</Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {editing ? (
        <EditRow
          spec={spec}
          lists={lists}
          row={editing === 'new' ? null : editing}
          decimals={data?.settings.currencyDecimals ?? 2}
          // Modifier groups hidden for now: uncomment to show "Asks for" on the item form.
          // withGroups={entity === 'items'}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      ) : null}

      {importing ? (
        <MenuImport
          onClose={() => setImporting(false)}
          onDone={async () => { await refresh(spec); await load() }}
        />
      ) : null}

      {bulk ? (
        <BulkTables
          areas={lists.areas ?? []}
          onClose={() => setBulk(false)}
          onDone={async () => { setBulk(false); await refresh(spec); await load() }}
          onError={setError}
        />
      ) : null}
    </div>
  )
}

/* ─────────────────────────── rendering ─────────────────────────── */

function labelFor(f: Field, row: Row, lists: Lists): string {
  const value = row[f.key]
  if (f.kind !== 'select') return String(value ?? '')
  if (f.choices) return f.choices.find((c) => String(c.value) === String(value))?.label ?? '—'
  const list = lists[f.from ?? ''] ?? []
  return (list.find((r) => r.id === value)?.name as string) ?? '—'
}

function display(f: Field, row: Row, lists: Lists) {
  const value = row[f.key]
  if (f.kind === 'bool') {
    return value
      ? <Pill label="Yes" tone="success" />
      : <span className="faint">No</span>
  }
  if (f.kind === 'money') {
    return <span className="money">{(Number(value ?? 0) / 100).toFixed(2)}</span>
  }
  if (f.key === 'ip') {
    return <span className="muted" style={{ fontFamily: 'ui-monospace, monospace' }}>{String(value ?? '')}</span>
  }
  const text = labelFor(f, row, lists)
  return f.key === 'name' ? <strong>{text}</strong> : <span className={text === '—' ? 'faint' : ''}>{text}</span>
}

function EditRow({ spec, lists, row, decimals, withGroups, onCancel, onSave }: {
  spec: MasterSpec
  lists: Lists
  row: Row | null
  decimals: number
  /** Items only: which modifier groups the tablet and counter ask for. */
  withGroups?: boolean
  onCancel: () => void
  onSave: (values: Record<string, unknown>, groupIds?: string[]) => void
}) {
  const [groupIds, setGroupIds] = useState<string[] | null>(withGroups && !row ? [] : null)
  useEffect(() => {
    if (!withGroups || !row) return
    api.itemModifierGroups(row.id)
      .then((r) => setGroupIds(r.groupIds))
      .catch(() => setGroupIds([]))
  }, [withGroups, row])
  const groups = [...(lists.modifierGroups ?? [])]
    .filter((g) => g.active !== false || groupIds?.includes(g.id))
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
  const toggleGroup = (id: string) => setGroupIds((prev) => {
    const cur = prev ?? []
    // Keep the groups in their configured order, so the sheet asks
    // "Spice Level" before "Add-ons" whatever order they were ticked in.
    const next = cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id]
    return groups.map((g) => g.id).filter((g) => next.includes(g))
  })

  const initial = useMemo(() => {
    const out: Record<string, unknown> = { ...(spec.defaults ?? {}) }
    for (const f of spec.fields) {
      const v = row?.[f.key]
      out[f.key] = row ? (f.kind === 'money' ? Number(v ?? 0) / 10 ** decimals : v) : out[f.key]
      if (f.kind === 'money' && !row) out[f.key] = 0

      // A required <select> shows its first option, but React state stays
      // undefined until someone changes it — so creating a row without touching
      // the dropdown sent no value at all and the server answered "Required".
      if (f.kind === 'select' && !f.nullable && (out[f.key] === undefined || out[f.key] === null)) {
        const first = f.choices?.[0]?.value ?? (lists[f.from ?? ''] ?? [])[0]?.id
        if (first !== undefined) out[f.key] = first
      }
    }
    return out
  }, [spec, row, decimals, lists])

  const [values, setValues] = useState(initial)
  const set = (key: string, v: unknown) => setValues((prev) => ({ ...prev, [key]: v }))

  const submit = () => {
    const out: Record<string, unknown> = {}
    for (const f of spec.fields) {
      const v = values[f.key]
      if (f.kind === 'money') out[f.key] = Math.round(Number(v || 0) * 10 ** decimals)
      else if (f.kind === 'number') out[f.key] = Number(v || 0)
      else if (f.kind === 'bool') out[f.key] = Boolean(v)
      else if (f.kind === 'select' && f.choices && f.key === 'width') out[f.key] = Number(v)
      else if (f.kind === 'select' && f.nullable && !v) out[f.key] = null
      else out[f.key] = v === '' ? null : v
    }
    onSave(out, withGroups && groupIds ? groupIds : undefined)
  }

  return (
    <Modal
      title={row ? `Edit ${spec.title.replace(/s$/, '')}` : `Add ${spec.title.replace(/s$/, '')}`}
      onClose={onCancel}
      width={560}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {spec.fields.map((f) => (
          <FieldWrap key={f.key} label={f.label}>
            {f.kind === 'bool' ? (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', height: 'var(--control-h)' }}>
                <input
                  type="checkbox"
                  checked={Boolean(values[f.key])}
                  onChange={(e) => set(f.key, e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <span className="muted">{values[f.key] ? 'Yes' : 'No'}</span>
              </label>
            ) : f.kind === 'select' ? (
              <select style={inputStyle} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                {f.nullable ? <option value="">— none —</option> : null}
                {(f.choices ?? (lists[f.from ?? ''] ?? []).map((r) => ({
                  value: r.id, label: String(r.name ?? r.id),
                }))).map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            ) : (
              <input
                style={{ ...inputStyle, textAlign: f.kind === 'text' ? 'left' : 'right' }}
                value={String(values[f.key] ?? '')}
                inputMode={f.kind === 'text' ? 'text' : 'decimal'}
                placeholder={f.kind === 'text' ? f.placeholder : undefined}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </FieldWrap>
        ))}
        {withGroups ? (
          // Not FieldWrap: that is a <label>, and these are labels of their own.
          <div style={{ display: 'grid', gap: 4 }}>
            <span className="label">Asks for (modifier groups)</span>
            {groupIds == null ? <span className="muted">Loading…</span>
              : groups.length === 0 ? (
                <span className="muted">No modifier groups yet. Add them under Modifier groups first.</span>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {groups.map((g) => (
                    <label key={g.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={groupIds.includes(g.id)}
                        onChange={() => toggleGroup(g.id)}
                        style={{ width: 18, height: 18 }}
                      />
                      <span>{String(g.name)}</span>
                      <span className="faint" style={{ fontSize: 13 }}>
                        {Number(g.minSelect ?? 0) > 0 ? 'required' : 'optional'}
                        {Number(g.maxSelect ?? 1) > 1 ? ` · up to ${g.maxSelect}` : ' · pick one'}
                      </span>
                    </label>
                  ))}
                </div>
              )}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={withGroups && groupIds == null} onClick={submit}>Save</Button>
      </div>
    </Modal>
  )
}

function BulkTables({ areas, onClose, onDone, onError }: {
  areas: Row[]
  onClose: () => void
  onDone: () => void
  onError: (m: string) => void
}) {
  const operator = useStore((s) => s.operator)
  const [areaId, setAreaId] = useState(areas[0]?.id ?? '')
  const [prefix, setPrefix] = useState('A')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('12')
  const [seats, setSeats] = useState('4')

  return (
    <Modal title="Bulk add tables" subtitle="Lay out a numbered run — A1 to A12." onClose={onClose} width={520}>
      <FieldWrap label="Area">
        <select style={inputStyle} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          {areas.map((a) => <option key={a.id} value={a.id}>{String(a.name)}</option>)}
        </select>
      </FieldWrap>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        <FieldWrap label="Prefix">
          <input style={inputStyle} value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="From">
          <input style={{ ...inputStyle, textAlign: 'right' }} value={from} onChange={(e) => setFrom(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="To">
          <input style={{ ...inputStyle, textAlign: 'right' }} value={to} onChange={(e) => setTo(e.target.value)} />
        </FieldWrap>
        <FieldWrap label="Seats">
          <input style={{ ...inputStyle, textAlign: 'right' }} value={seats} onChange={(e) => setSeats(e.target.value)} />
        </FieldWrap>
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => {
          if (!operator) return onError('Sign in at the counter first.')
          try {
            await api.bulkTables({
              areaId, prefix, from: Number(from), to: Number(to), seats: Number(seats),
            }, operator.id)
            onDone()
          } catch (e) {
            onError(e instanceof ApiError ? e.message : 'Something went wrong.')
          }
        }}>Add tables</Button>
      </div>
    </Modal>
  )
}

const thStyle = (f?: Field): React.CSSProperties => ({
  textAlign: 'left', fontSize: 13, fontWeight: 500, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: 'var(--text-muted)', padding: '10px 12px',
  borderBottom: '1px solid var(--border)', width: f?.width, whiteSpace: 'nowrap',
})
const tdStyle = (f: Field): React.CSSProperties => ({
  padding: '8px 12px', width: f.width,
  textAlign: f.kind === 'money' ? 'right' : 'left',
})
