import { useEffect, useMemo, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { MenuImportPlan, MenuImportRow } from '../api/types'
import { Banner, Button, Modal, Pill } from '../components/ui'
import { sheetToRows, templateCsv } from '../masters/csv'
import type { Row } from '../masters/config'
import { useStore } from '../store'

interface Sheet { name: string; rows: MenuImportRow[] }

/** Where a category's KOTs will print once the import is applied. */
interface Route {
  category: string
  isNew: boolean
  kitchen: string | null
  /** True when no kitchen is set and KOTs fall back to settings.defaultKitchenId. */
  viaDefault: boolean
  printer: string | null
  printerOff: boolean
}

/**
 * Menu import from a CSV: categories and items in one sheet.
 *
 * Always plans first. The routing table is the point of the preview — a
 * category pointed at the wrong kitchen prints its KOTs in the wrong room,
 * and nobody notices until service.
 */
export function MenuImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { operator, data } = useStore()
  const decimals = data?.settings.currencyDecimals ?? 2
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [plan, setPlan] = useState<MenuImportPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [kitchens, setKitchens] = useState<Row[]>([])
  const [printers, setPrinters] = useState<Row[]>([])
  const [categories, setCategories] = useState<Row[]>([])

  useEffect(() => {
    Promise.all([api.masters<Row>('kitchens'), api.masters<Row>('printers'), api.masters<Row>('categories')])
      .then(([k, p, c]) => { setKitchens(k); setPrinters(p); setCategories(c) })
      .catch(() => setError('Could not reach the hub'))
  }, [])

  const money = (minor: number) => (minor / 10 ** decimals).toFixed(decimals)

  const pick = async (file: File) => {
    setPlan(null)
    setError(null)
    const parsed = sheetToRows(await file.text())
    if ('error' in parsed) { setSheet(null); return setError(parsed.error) }
    const next = { name: file.name, ...parsed }
    setSheet(next)
    await run(next, true)
  }

  const run = async (target: Sheet, dryRun: boolean) => {
    if (!operator) return setError('Sign in at the counter first.')
    setBusy(true)
    try {
      const result = await api.importMenu(target.rows, dryRun, operator.id)
      setPlan(result)
      if (result.applied) onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const routes = useMemo<Route[]>(() => {
    if (!sheet || !plan) return []
    const kitchenById = new Map(kitchens.map((k) => [k.id, k]))
    const kitchenByName = new Map(kitchens.map((k) => [String(k.name).toLowerCase(), k]))
    const printerById = new Map(printers.map((p) => [p.id, p]))
    const created = new Map(plan.categoriesToCreate.map((c) => [c.name.toLowerCase(), c]))
    const fallback = data?.settings.defaultKitchenId ?? null

    const seen = new Set<string>()
    const out: Route[] = []
    for (const r of sheet.rows) {
      const lower = r.category.toLowerCase()
      if (!lower || seen.has(lower)) continue
      seen.add(lower)

      const existing = categories.find((c) => String(c.name).toLowerCase() === lower)
      const newOne = created.get(lower)
      let kitchenId: string | null = null
      if (existing) kitchenId = (existing.kitchenId as string | null) ?? null
      else if (newOne?.kitchen) kitchenId = (kitchenByName.get(newOne.kitchen.toLowerCase())?.id as string) ?? null

      const viaDefault = kitchenId === null
      const kitchen = kitchenById.get(kitchenId ?? fallback ?? '')
      const printer = kitchen ? printerById.get(kitchen.printerId as string) : undefined
      out.push({
        category: existing ? String(existing.name) : r.category,
        isNew: !existing,
        kitchen: kitchen ? String(kitchen.name) : null,
        viaDefault,
        printer: printer ? `${printer.name} · ${printer.ip}` : null,
        printerOff: printer ? printer.enabled === false : false,
      })
    }
    return out
  }, [sheet, plan, kitchens, printers, categories, data])

  const download = () => {
    const names = kitchens.filter((k) => k.active !== false).map((k) => String(k.name))
    const url = URL.createObjectURL(new Blob([templateCsv(names)], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'menu-template.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }

  const nothingToDo = plan
    && plan.categoriesToCreate.length + plan.itemsToCreate.length + plan.itemsToUpdate.length === 0

  return (
    <Modal
      title="Import menu"
      subtitle="One line per item: category, item, price, kitchen. Kitchens must already exist — the kitchen decides the KOT printer."
      onClose={onClose}
      width={820}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="card" style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 'var(--action-h)',
          cursor: 'pointer', fontWeight: 600, flex: 1, minWidth: 260,
        }}>
          <input
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }}
          />
          {sheet ? <>{sheet.name} <span className="muted">· {sheet.rows.length} items · choose another</span></> : 'Choose CSV file…'}
        </label>
        <Button variant="ghost" onClick={download}>Download template</Button>
      </div>

      {error ? <Banner tone="danger">{error}</Banner> : null}
      {busy ? <div className="muted">Checking…</div> : null}

      {plan?.applied ? (
        <Banner tone="success">
          Imported — {plan.categoriesToCreate.length} categories and {plan.itemsToCreate.length} items added,
          {' '}{plan.itemsToUpdate.length} prices changed.
        </Banner>
      ) : null}

      {plan && plan.errors.length > 0 ? (
        <Section title={`${plan.errors.length} problem${plan.errors.length === 1 ? '' : 's'} — fix the sheet and choose it again`}>
          {plan.errors.map((e, i) => (
            <div key={i} style={{ color: 'var(--danger)' }}>Line {e.row}: {e.message}</div>
          ))}
        </Section>
      ) : null}

      {plan && plan.warnings.length > 0 ? (
        <Section title="Worth knowing">
          {plan.warnings.map((w, i) => (
            <div key={i} style={{ color: 'var(--warning)' }}>Line {w.row}: {w.message}</div>
          ))}
        </Section>
      ) : null}

      {routes.length > 0 && plan && plan.errors.length === 0 ? (
        <Section title="KOT routing — check every line">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Category', 'Kitchen', 'Printer'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.category} style={{ borderTop: '1px solid var(--border)', height: 'var(--row-h)' }}>
                  <td style={td}>
                    <strong>{r.category}</strong>{' '}
                    {r.isNew ? <Pill label="New" tone="primary" /> : <span className="faint">existing</span>}
                  </td>
                  <td style={td}>
                    {r.kitchen ?? <span style={{ color: 'var(--danger)' }}>none — KOT has nowhere to go</span>}
                    {r.kitchen && r.viaDefault ? <span className="muted"> (default kitchen)</span> : null}
                  </td>
                  <td style={td}>
                    {r.printer ?? '—'}
                    {r.printerOff ? <> <Pill label="Disabled" tone="warning" /></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 13 }}>
            Existing categories keep their kitchen. Change routing later under Categories.
          </div>
        </Section>
      ) : null}

      {plan && plan.errors.length === 0 && !plan.applied ? (
        <Section title="Changes">
          <div>
            {plan.categoriesToCreate.length} new categories · {plan.itemsToCreate.length} new items
            {' '}· {plan.itemsToUpdate.length} price changes · {plan.unchanged} unchanged
          </div>
          {plan.itemsToUpdate.map((u) => (
            <div key={`${u.category}/${u.name}`} className="muted">
              {u.category} › {u.name}: <span className="money">{money(u.from)}</span> → <strong className="money">{money(u.to)}</strong>
            </div>
          ))}
        </Section>
      ) : null}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{plan?.applied ? 'Done' : 'Cancel'}</Button>
        {plan && !plan.applied ? (
          <Button
            variant="primary"
            disabled={busy || plan.errors.length > 0 || Boolean(nothingToDo)}
            onClick={() => sheet && void run(sheet, false)}
          >
            {nothingToDo ? 'Nothing to change' : 'Import'}
          </Button>
        ) : null}
      </div>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span className="label">{title}</span>
      {children}
    </div>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 13, fontWeight: 500, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: 'var(--text-muted)', padding: '8px 12px',
}
const td: React.CSSProperties = { padding: '8px 12px' }
