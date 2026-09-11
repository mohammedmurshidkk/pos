/**
 * Money & tax calculation.
 *
 * RULE: every amount in this file is an INTEGER in the currency's minor unit.
 * AED 25.50 is 2550. Never floats, never Number.toFixed on money.
 *
 * AED/SAR/QAR have 2 decimals. KWD/BHD/OMR have 3. That lives in TaxConfig.
 */

export type DiscountType = 'none' | 'percent' | 'amount'

export interface TaxConfig {
  /** Percent, e.g. 5 for UAE VAT. Never hardcode this anywhere else. */
  taxRate: number
  /** UAE consumer-facing convention is inclusive (menu price = price paid). */
  priceIncludesTax: boolean
  /** Percent. 0 unless the venue adds a service charge. */
  serviceChargePct: number
  /** 2 for AED, 3 for KWD/BHD/OMR. */
  currencyDecimals: number
}

export interface CalcLine {
  qty: number
  /** Minor units, per single unit. */
  unitPrice: number
  /** Minor units, per single unit — added to unitPrice before multiplying by qty. */
  modifierDeltas?: number[]
}

export interface CalcDiscount {
  type: DiscountType
  /** Percent when type==='percent', minor units when type==='amount'. */
  value: number
}

export interface LineResult {
  /** qty × (unitPrice + modifiers). Gross when inclusive, net when exclusive. */
  lineTotal: number
}

export interface CalcResult {
  lines: LineResult[]
  /** Sum of line totals, before discount. This is what prints as "Subtotal". */
  subtotal: number
  discountAmount: number
  serviceCharge: number
  /** Tax-exclusive value of the sale. */
  net: number
  tax: number
  /** What the customer pays. */
  total: number
}

/**
 * Half-up rounding to a whole minor unit.
 * The epsilon guards against float representation error creeping in from the
 * percentage maths (e.g. 0.5 arriving as 0.49999999999999994).
 */
export const roundMinor = (n: number): number =>
  Math.round(n + (n >= 0 ? 1e-9 : -1e-9))

const lineTotal = (line: CalcLine): number => {
  const deltas = (line.modifierDeltas ?? []).reduce((a, b) => a + b, 0)
  return line.qty * (line.unitPrice + deltas)
}

const discountFor = (base: number, discount: CalcDiscount): number => {
  if (discount.type === 'none' || discount.value <= 0) return 0
  const raw =
    discount.type === 'percent'
      ? roundMinor((base * discount.value) / 100)
      : roundMinor(discount.value)
  // Never let a discount exceed the bill — that would invert the invoice.
  return Math.min(raw, base)
}

/**
 * Calculate a bill.
 *
 * Order of operations (both modes): lines → discount → service charge → tax.
 * Discount is applied BEFORE tax, which is what the FTA expects.
 * Rounding happens at bill level, not per line.
 */
export function calculate(
  lines: CalcLine[],
  discount: CalcDiscount,
  config: TaxConfig,
): CalcResult {
  const lineResults = lines.map((l) => ({ lineTotal: lineTotal(l) }))
  const subtotal = lineResults.reduce((a, l) => a + l.lineTotal, 0)

  const discountAmount = discountFor(subtotal, discount)
  const afterDiscount = subtotal - discountAmount
  const serviceCharge = roundMinor((afterDiscount * config.serviceChargePct) / 100)
  const base = afterDiscount + serviceCharge

  const rate = config.taxRate / 100

  if (config.priceIncludesTax) {
    // Prices already contain tax. Back it out of the gross figure.
    const net = roundMinor(base / (1 + rate))
    return {
      lines: lineResults,
      subtotal,
      discountAmount,
      serviceCharge,
      net,
      tax: base - net,
      total: base,
    }
  }

  const tax = roundMinor(base * rate)
  return {
    lines: lineResults,
    subtotal,
    discountAmount,
    serviceCharge,
    net: base,
    tax,
    total: base + tax,
  }
}

/**
 * Format minor units for display or printing.
 * `currencyDisplay` comes from settings — never print the ₹ glyph on a thermal
 * printer, most ESC/POS codepages don't have it. Use "INR" or "Rs.".
 */
export function formatMoney(
  minor: number,
  decimals: number,
  currencyDisplay?: string,
): string {
  const neg = minor < 0
  const abs = Math.abs(minor)
  const factor = 10 ** decimals
  const whole = Math.floor(abs / factor)
  const frac = String(abs % factor).padStart(decimals, '0')
  const body =
    decimals === 0
      ? whole.toLocaleString('en-US')
      : `${whole.toLocaleString('en-US')}.${frac}`
  // U+2212 minus, not a hyphen — it aligns in tabular figures.
  const signed = neg ? `−${body}` : body
  return currencyDisplay ? `${currencyDisplay} ${signed}` : signed
}

/** Sum of settled payments vs order total. */
export const balanceDue = (total: number, paid: number): number =>
  Math.max(0, total - paid)

export const changeDue = (total: number, paid: number): number =>
  Math.max(0, paid - total)

export const isSettled = (total: number, paid: number): boolean => paid >= total
