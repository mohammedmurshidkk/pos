import { describe, expect, it } from 'vitest'
import {
  balanceDue,
  calculate,
  changeDue,
  formatMoney,
  isSettled,
  roundMinor,
  type CalcDiscount,
  type TaxConfig,
} from './money.js'

/** Al Manzil, Dubai: AED, 5% VAT, menu prices include tax, no service charge. */
const UAE: TaxConfig = {
  taxRate: 5,
  priceIncludesTax: true,
  serviceChargePct: 0,
  currencyDecimals: 2,
}
const UAE_EX: TaxConfig = { ...UAE, priceIncludesTax: false }
const NONE: CalcDiscount = { type: 'none', value: 0 }

describe('inclusive pricing (UAE default)', () => {
  it('backs VAT out of the gross total', () => {
    // 1 × Periperi Alfaham @ 85.00
    const r = calculate([{ qty: 1, unitPrice: 8500 }], NONE, UAE)
    expect(r.total).toBe(8500)
    expect(r.net).toBe(8095) // 8500 / 1.05 = 8095.238 → 8095
    expect(r.tax).toBe(405)
    expect(r.net + r.tax).toBe(r.total)
  })

  it('never lets net + tax drift from total', () => {
    // Guards the rounding seam: tax is derived by subtraction, not rounded twice.
    for (let gross = 1; gross <= 3000; gross++) {
      const r = calculate([{ qty: 1, unitPrice: gross }], NONE, UAE)
      expect(r.net + r.tax).toBe(r.total)
    }
  })

  it('handles the spec worked example', () => {
    // Periperi 85 + 2×Noodles 38 + Juice 22 + Lemonade 18, then 10.00 off
    const r = calculate(
      [
        { qty: 1, unitPrice: 8500 },
        { qty: 2, unitPrice: 3800 },
        { qty: 1, unitPrice: 2200 },
        { qty: 1, unitPrice: 1800 },
      ],
      { type: 'amount', value: 1000 },
      UAE,
    )
    expect(r.subtotal).toBe(20100)
    expect(r.discountAmount).toBe(1000)
    expect(r.total).toBe(19100)
    expect(r.net + r.tax).toBe(19100)
  })
})

describe('exclusive pricing', () => {
  it('adds VAT on top', () => {
    const r = calculate([{ qty: 1, unitPrice: 10000 }], NONE, UAE_EX)
    expect(r.net).toBe(10000)
    expect(r.tax).toBe(500)
    expect(r.total).toBe(10500)
  })
})

describe('modifiers', () => {
  it('adds deltas per unit, before multiplying by qty', () => {
    // 2 × (85.00 + 5.00 garlic sauce)
    const r = calculate(
      [{ qty: 2, unitPrice: 8500, modifierDeltas: [500] }],
      NONE,
      UAE,
    )
    expect(r.subtotal).toBe(18000)
    expect(r.lines[0]!.lineTotal).toBe(18000)
  })

  it('supports multiple and zero-price modifiers', () => {
    const r = calculate(
      [{ qty: 1, unitPrice: 8500, modifierDeltas: [0, 500, 800] }],
      NONE,
      UAE,
    )
    expect(r.subtotal).toBe(9800)
  })
})

describe('discounts', () => {
  it('applies a percentage before tax', () => {
    const r = calculate([{ qty: 1, unitPrice: 10000 }], { type: 'percent', value: 10 }, UAE)
    expect(r.discountAmount).toBe(1000)
    expect(r.total).toBe(9000)
  })

  it('caps an amount discount at the bill total', () => {
    // Staff must not be able to invert an invoice with a fat-fingered discount.
    const r = calculate([{ qty: 1, unitPrice: 5000 }], { type: 'amount', value: 9999 }, UAE)
    expect(r.discountAmount).toBe(5000)
    expect(r.total).toBe(0)
  })

  it('caps a percentage over 100', () => {
    const r = calculate([{ qty: 1, unitPrice: 5000 }], { type: 'percent', value: 150 }, UAE)
    expect(r.total).toBe(0)
  })

  it('ignores zero and negative values', () => {
    const r = calculate([{ qty: 1, unitPrice: 5000 }], { type: 'amount', value: -500 }, UAE)
    expect(r.discountAmount).toBe(0)
    expect(r.total).toBe(5000)
  })
})

describe('service charge', () => {
  const SVC: TaxConfig = { ...UAE, serviceChargePct: 10 }

  it('applies after discount and is itself taxable', () => {
    const r = calculate([{ qty: 1, unitPrice: 10000 }], NONE, SVC)
    expect(r.serviceCharge).toBe(1000)
    expect(r.total).toBe(11000)
    expect(r.net + r.tax).toBe(11000)
  })

  it('is calculated on the discounted amount, not the original', () => {
    const r = calculate([{ qty: 1, unitPrice: 10000 }], { type: 'percent', value: 50 }, SVC)
    expect(r.discountAmount).toBe(5000)
    expect(r.serviceCharge).toBe(500) // 10% of 5000, not of 10000
    expect(r.total).toBe(5500)
  })
})

describe('three-decimal currencies', () => {
  it('works for KWD/BHD/OMR', () => {
    const OMR: TaxConfig = { taxRate: 5, priceIncludesTax: true, serviceChargePct: 0, currencyDecimals: 3 }
    const r = calculate([{ qty: 1, unitPrice: 12500 }], NONE, OMR) // 12.500 OMR
    expect(r.total).toBe(12500)
    expect(formatMoney(r.total, 3, 'OMR')).toBe('OMR 12.500')
  })
})

describe('edge cases', () => {
  it('handles an empty bill', () => {
    const r = calculate([], NONE, UAE)
    expect(r).toMatchObject({ subtotal: 0, tax: 0, total: 0, net: 0 })
  })

  it('handles a zero-rate jurisdiction (Kuwait, Qatar)', () => {
    const r = calculate([{ qty: 1, unitPrice: 5000 }], NONE, { ...UAE, taxRate: 0 })
    expect(r.tax).toBe(0)
    expect(r.net).toBe(5000)
    expect(r.total).toBe(5000)
  })

  it('rounds half up', () => {
    expect(roundMinor(0.5)).toBe(1)
    expect(roundMinor(1.4999)).toBe(1)
    expect(roundMinor(2.5)).toBe(3)
  })
})

describe('formatMoney', () => {
  it('formats with the configured decimals', () => {
    expect(formatMoney(245000, 2, 'AED')).toBe('AED 2,450.00')
    expect(formatMoney(8500, 2)).toBe('85.00')
    expect(formatMoney(5, 2)).toBe('0.05')
  })

  it('uses a true minus sign so columns align in tabular figures', () => {
    expect(formatMoney(-1000, 2, 'AED')).toBe('AED −10.00')
  })
})

describe('payments', () => {
  it('tracks balance, change and settlement across split tenders', () => {
    const total = 24500
    expect(balanceDue(total, 9500)).toBe(15000)
    expect(isSettled(total, 9500)).toBe(false)
    expect(isSettled(total, 24500)).toBe(true)
    expect(changeDue(total, 30000)).toBe(5500)
    expect(balanceDue(total, 30000)).toBe(0)
  })
})
