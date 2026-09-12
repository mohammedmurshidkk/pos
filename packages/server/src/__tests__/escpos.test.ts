import { describe, expect, it } from 'vitest'
import { Receipt, colsFor, toPrintable } from '../escpos.js'

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
