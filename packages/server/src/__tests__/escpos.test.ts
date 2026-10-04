import { describe, expect, it } from 'vitest'
import { Receipt, colsFor, toPrintable } from '../escpos.js'
import { type BillPayload, renderBill, renderJob } from '../templates.js'

describe('toPrintable', () => {
  it('keeps the minus sign on negative figures', () => {
    // formatMoney uses U+2212 so columns align on screen; latin1 would eat it.
    expect(toPrintable('VARIANCE  −10.00')).toBe('VARIANCE  -10.00')
  })

  it('strips accents rather than emitting control bytes', () => {
    expect(toPrintable('Crème Brûlée')).toBe('Creme Brulee')
  })

  it('folds typographic punctuation', () => {
    expect(toPrintable('“Special” — chef’s choice…')).toBe('"Special" - chef\'s choice...')
  })

  it('replaces anything still unprintable instead of dropping it', () => {
    expect(toPrintable('spicy 🌶 dish')).toBe('spicy ? dish')
  })

  it('leaves ESC/POS control codes alone', () => {
    expect(toPrintable('\x1b@\x1dV\x42\x00')).toBe('\x1b@\x1dV\x42\x00')
  })
})

describe('Receipt', () => {
  it('emits no byte above 0x7f', () => {
    const buf = new Receipt(48).line('Crème −10.00 “x”').toBuffer()
    expect([...buf].every((b) => b <= 0x7f)).toBe(true)
  })

  it('right-aligns values to the paper width', () => {
    const out = new Receipt(32).kv('TOTAL', 'AED 129.00').toBuffer().toString('binary')
    const line = out.split('\n')[0]!.replace('\x1b@', '') // drop the init sequence
    expect(line.length).toBe(32)
    expect(line).toBe('TOTAL                 AED 129.00')
  })

  it('uses 48 columns for 80mm and 32 for 58mm', () => {
    expect(colsFor(80)).toBe(48)
    expect(colsFor(58)).toBe(32)
  })
})

describe('customer bill', () => {
  const bill = (extra: Partial<BillPayload> = {}): BillPayload => ({
    businessName: 'Al Manzil', addressLine: 'Deira', phone: '04 000 0000',
    taxNumberLabel: 'TRN', taxNumberValue: '100000000000003', taxName: 'VAT', taxRatePct: 5,
    currencyDisplay: 'AED', currencyDecimals: 2, invoiceNo: 'INV-7', orderNo: 12, orderType: 'dine_in',
    tableLabel: 'A1', waiterName: 'Rahul', counterName: 'Main', at: '3 Oct 2026, 20:00',
    reprintCount: 0, wasEditedAfterPrint: false,
    lines: [{ qty: 1, name: 'Tea', amount: 1050 }],
    subtotal: 1050, discountAmount: 0, serviceCharge: 0, net: 1000, tax: 50, total: 1050,
    footer: 'Thank you', ...extra,
  })
  const text = (b: Buffer) => b.toString('latin1')

  it('is always a tax invoice with the TRN and VAT breakdown', () => {
    const out = text(renderBill(bill(), 80))
    expect(out).toContain('TAX INVOICE')
    expect(out).toContain('TRN: 100000000000003')
    expect(out).toMatch(/VAT 5%\s+0\.50/)
    expect(out).not.toMatch(/not a tax invoice/i)
  })

  it('leaves the kitchen note off the bill but keeps modifiers', () => {
    const out = text(renderBill(bill({
      lines: [{ qty: 1, name: 'Tea', amount: 1050, modifiers: ['Less sugar'], note: 'No ice please' }],
    }), 80))
    expect(out).toContain('Less sugar')
    expect(out).not.toContain('No ice please')
  })

  it('prints the customer on the bill, and the delivery address', () => {
    const out = text(renderBill(bill({
      orderType: 'delivery', tableLabel: '0559998888', customerName: 'Sara',
      customerPhone: '0559998888', deliveryAddress: 'Villa 12, Al Nahda',
    }), 80))
    expect(out).toMatch(/Customer\s+Sara/)
    expect(out).toContain('Deliver to: Villa 12, Al Nahda')
    // The phone is already the delivery label; it is not printed twice.
    expect(out.match(/0559998888/g)).toHaveLength(1)
  })

  it('opens the drawer only when asked', () => {
    expect(text(renderBill(bill(), 80))).not.toContain('\x1bp')
    expect(text(renderBill(bill({ openDrawer: true }), 80))).toContain('\x1bp\x00\x19\x78')
  })

  it('a drawer job kicks without printing or cutting paper', () => {
    expect(text(renderJob('drawer', {}, 80))).toBe('\x1b@\x1bp\x00\x19\x78')
  })
})
