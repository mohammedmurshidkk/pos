import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Customer } from '../api/types'
import { Field, inputStyle } from './ui'

const digits = (p: string) => p.replace(/\D/g, '')

/**
 * Phone first, then name. Customers are unique by phone number, so a known
 * number fills the name in (and, for delivery, offers the saved addresses).
 * The hub does the saving; this only looks up.
 */
export function CustomerFields({ phone, name, onPhone, onName, onFound, autoFocus, row }: {
  phone: string
  name: string
  onPhone: (v: string) => void
  onName: (v: string) => void
  /** Called with the stored customer, or null for a new number. */
  onFound?: (c: Customer | null) => void
  autoFocus?: boolean
  /** Phone and name side by side, as in the settle dialog. */
  row?: boolean
}) {
  const [found, setFound] = useState<Customer | null>(null)
  const [looked, setLooked] = useState(false)

  useEffect(() => {
    const p = digits(phone)
    if (p.length < 7) { setFound(null); setLooked(false); onFound?.(null); return }
    // Wait for the typing to stop before asking the hub.
    const t = setTimeout(() => {
      api.lookupCustomer(p).then(({ customer }) => {
        setFound(customer)
        setLooked(true)
        onFound?.(customer)
        if (customer?.name && !name.trim()) onName(customer.name)
      }).catch(() => { /* lookup is a convenience; typing still works */ })
    }, 300)
    return () => clearTimeout(t)
    // Only the number triggers a lookup; name edits must not re-fill it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  // Side by side in a narrow panel: let both inputs shrink with their column instead of overflowing it.
  const fill: React.CSSProperties = { ...inputStyle, width: '100%', minWidth: 0 }
  const phoneField = (
    <Field label="Phone">
      <input
        style={row ? fill : inputStyle} inputMode="tel" value={phone} autoFocus={autoFocus}
        placeholder="050 123 4567" onChange={(e) => onPhone(e.target.value)}
      />
    </Field>
  )
  const status = looked ? (
    <span className="muted" style={{ fontSize: 13 }}>
      {found
        ? `Returning customer · ${found.orderCount} order${found.orderCount === 1 ? '' : 's'}`
        : 'New customer'}
    </span>
  ) : null
  const nameField = (
    <Field label="Name">
      <input style={row ? fill : inputStyle} value={name} onChange={(e) => onName(e.target.value)} />
    </Field>
  )

  if (row) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>{phoneField}{status}</div>
        {nameField}
      </div>
    )
  }
  return <>{phoneField}{status}{nameField}</>
}
