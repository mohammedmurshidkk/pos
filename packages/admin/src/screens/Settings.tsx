import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api } from '../api/client'
import type { Kitchen, Settings as SettingsRow, SettingsPatch } from '../api/types'
import { Banner, Button, Field, inputStyle } from '../components/ui'
import { useStore } from '../store'

/** Everything the form edits, held as strings until save. */
interface Form {
  businessName: string
  addressLine: string
  phone: string
  receiptFooter: string
  currencyDisplay: string
  taxName: string
  taxRate: string
  taxNumberLabel: string
  taxNumberValue: string
  priceIncludesTax: boolean
  serviceCharge: string
  invoicePrefix: string
  businessDayStartHour: string
  defaultKitchenId: string
}

/** 500 bp → "5". Integer arithmetic only, so 525 shows as "5.25", not 5.2499… */
const bpToPercent = (bp: number) => {
  const whole = Math.floor(bp / 100)
  const frac = String(bp % 100).padStart(2, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : String(whole)
}

/** "5.25" → 525, or null if it is not a percentage with at most two decimals. */
const percentToBp = (text: string): number | null => {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

const toForm = (s: SettingsRow): Form => ({
  businessName: s.businessName,
  addressLine: s.addressLine,
  phone: s.phone,
  receiptFooter: s.receiptFooter,
  currencyDisplay: s.currencyDisplay,
  taxName: s.taxName,
  taxRate: bpToPercent(s.taxRateBp),
  taxNumberLabel: s.taxNumberLabel,
  taxNumberValue: s.taxNumberValue,
  priceIncludesTax: s.priceIncludesTax,
  serviceCharge: bpToPercent(s.serviceChargeBp),
  invoicePrefix: s.invoicePrefix,
  businessDayStartHour: String(s.businessDayStartHour),
  defaultKitchenId: s.defaultKitchenId ?? '',
})

/**
 * Turn the form into the fields that actually changed. Sending only the diff
 * keeps the audit row honest about what was edited.
 */
function diff(form: Form, current: SettingsRow): { patch: SettingsPatch } | { error: string } {
  const taxRateBp = percentToBp(form.taxRate)
  if (taxRateBp === null || taxRateBp > 10_000) return { error: 'Tax rate must be a percentage, e.g. 5 or 5.25.' }
  const serviceChargeBp = percentToBp(form.serviceCharge)
  if (serviceChargeBp === null || serviceChargeBp > 10_000) return { error: 'Service charge must be a percentage, e.g. 0 or 10.' }
  const hour = Number(form.businessDayStartHour)

  const next: SettingsPatch = {
    businessName: form.businessName.trim(),
    addressLine: form.addressLine.trim(),
    phone: form.phone.trim(),
    receiptFooter: form.receiptFooter.trim(),
    currencyDisplay: form.currencyDisplay.trim(),
    taxName: form.taxName.trim(),
    taxRateBp,
    taxNumberLabel: form.taxNumberLabel.trim(),
    taxNumberValue: form.taxNumberValue.trim(),
    priceIncludesTax: form.priceIncludesTax,
    serviceChargeBp,
    invoicePrefix: form.invoicePrefix.trim(),
    businessDayStartHour: hour,
    defaultKitchenId: form.defaultKitchenId || null,
  }
  const patch: SettingsPatch = {}
  for (const [k, v] of Object.entries(next) as [keyof SettingsPatch, unknown][]) {
    if (current[k] !== v) (patch as Record<string, unknown>)[k] = v
  }
  return { patch }
}

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: h === 0 ? 'Midnight (00:00)' : `${String(h).padStart(2, '0')}:00`,
}))

/**
 * Shop-wide settings: what prints on the receipt, tax, invoicing and which
 * kitchen gets items whose category has none.
 *
 * Currency code and decimals are shown but not editable — every price is stored
 * in minor units, so changing the decimals would silently rescale the menu and
 * all past sales.
 */
export function Settings() {
  const { operator, data, load } = useStore()
  const current = data?.settings ?? null
  const [form, setForm] = useState<Form | null>(current ? toForm(current) : null)
  const [kitchens, setKitchens] = useState<Kitchen[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadKitchens = useCallback(async () => {
    try {
      setKitchens(await api.masters<Kitchen>('kitchens'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the hub')
    }
  }, [])

  useEffect(() => { void loadKitchens() }, [loadKitchens])
  useEffect(() => { if (current && !form) setForm(toForm(current)) }, [current, form])

  const changes = useMemo(() => (form && current ? diff(form, current) : null), [form, current])
  const dirty = changes !== null && ('error' in changes || Object.keys(changes.patch).length > 0)

  if (!form || !current) return <div className="muted">Loading…</div>

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
    setNotice(null)
  }

  const save = async () => {
    if (!operator) return setError('Sign in at the counter first.')
    if (!changes) return
    if ('error' in changes) return setError(changes.error)
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.updateSettings(changes.patch, operator.id)
      await load() // nav title, money formatting and receipts read from bootstrap
      setForm(null) // re-seeded from the fresh bootstrap by the effect above
      setNotice('Settings saved.')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  // An inactive kitchen can stay selected if it already is, but cannot be chosen.
  const kitchenChoices = kitchens.filter((k) => k.active || k.id === current.defaultKitchenId)

  const text = (key: keyof Form, opts: { placeholder?: string; maxLength?: number } = {}) => (
    <input
      style={inputStyle}
      value={String(form[key])}
      placeholder={opts.placeholder}
      maxLength={opts.maxLength}
      onChange={(e) => set(key, e.target.value)}
    />
  )
  const percent = (key: 'taxRate' | 'serviceCharge') => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        style={{ ...inputStyle, textAlign: 'right', width: 120 }}
        inputMode="decimal"
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
      />
      <span className="muted">%</span>
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ flex: 1 }}>Settings</h1>
        <Button disabled={!dirty || busy} onClick={() => { setForm(toForm(current)); setError(null) }}>Discard</Button>
        <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}

      <Section title="Business" hint="Printed at the top and bottom of every bill and tax invoice.">
        <Field label="Business name">{text('businessName', { maxLength: 80 })}</Field>
        <Field label="Address">{text('addressLine', { maxLength: 120 })}</Field>
        <Field label="Phone">{text('phone', { maxLength: 40 })}</Field>
        <Field label="Receipt footer">{text('receiptFooter', { maxLength: 120, placeholder: 'Thank you — see you again' })}</Field>
      </Section>

      <Section title="Kitchen" hint="Items whose category has no kitchen print their ticket here.">
        <Field label="Default kitchen">
          <select style={inputStyle} value={form.defaultKitchenId} onChange={(e) => set('defaultKitchenId', e.target.value)}>
            <option value="">— none —</option>
            {kitchenChoices.map((k) => (
              <option key={k.id} value={k.id}>{k.name}{k.active ? '' : ' (inactive)'}</option>
            ))}
          </select>
        </Field>
        {kitchens.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>No kitchens yet — add one under Setup → Kitchens.</div>
        ) : null}
      </Section>

      <Section title="Tax">
        <Row>
          <Field label="Tax name">{text('taxName', { maxLength: 12 })}</Field>
          <Field label="Tax rate">{percent('taxRate')}</Field>
        </Row>
        <Row>
          <Field label="Tax number label">{text('taxNumberLabel', { maxLength: 12 })}</Field>
          <Field label={`${form.taxNumberLabel || 'Tax'} number`}>{text('taxNumberValue', { maxLength: 40 })}</Field>
        </Row>
        <Check
          label="Menu prices include tax"
          checked={form.priceIncludesTax}
          onChange={(v) => set('priceIncludesTax', v)}
        />
        <Field label="Service charge">{percent('serviceCharge')}</Field>
      </Section>

      <Section title="Invoicing">
        <Row>
          <Field label="Invoice prefix">{text('invoicePrefix', { maxLength: 10 })}</Field>
          <Field label="Next invoice number">
            <ReadOnly>{current.invoiceNextNo}</ReadOnly>
          </Field>
        </Row>
        <div className="muted" style={{ fontSize: 13 }}>
          Invoice numbers are gapless and cannot be changed.
        </div>
        <Field label="Business day starts at">
          <select style={inputStyle} value={form.businessDayStartHour} onChange={(e) => set('businessDayStartHour', e.target.value)}>
            {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
        </Field>
        <div className="muted" style={{ fontSize: 13 }}>
          Sales before this hour count towards the previous day&apos;s reports — set it after closing time.
        </div>
      </Section>

      <Section title="Currency">
        <Row>
          <Field label="Currency"><ReadOnly>{current.currencyCode} · {current.countryCode}</ReadOnly></Field>
          <Field label="Decimals"><ReadOnly>{current.currencyDecimals}</ReadOnly></Field>
        </Row>
        <Field label="Shown on receipts as">{text('currencyDisplay', { maxLength: 8 })}</Field>
        <div className="muted" style={{ fontSize: 13 }}>
          Currency and decimals are fixed at installation — changing them would rescale every stored price.
        </div>
      </Section>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: 24, display: 'grid', gap: 12 }}>
      <div>
        <h2>{title}</h2>
        {hint ? <div className="muted" style={{ marginTop: 2 }}>{hint}</div> : null}
      </div>
      {children}
    </div>
  )
}

const Row = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>
)

const ReadOnly = ({ children }: { children: ReactNode }) => (
  <div style={{
    ...inputStyle, display: 'flex', alignItems: 'center',
    background: 'var(--surface-alt)', color: 'var(--text-muted)',
  }}>{children}</div>
)

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', height: 'var(--control-h)', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18 }} />
      <span>{label}</span>
    </label>
  )
}
