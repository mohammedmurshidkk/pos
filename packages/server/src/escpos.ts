/**
 * ESC/POS text-mode renderer.
 *
 * English only in MVP, so plain text mode — faster than raster and simpler.
 * If Arabic is ever switched on, these builders get replaced by a canvas
 * rasteriser; nothing else changes.
 */

const ESC = '\x1b'
const GS = '\x1d'

export const CMD = {
  init: `${ESC}@`,
  boldOn: `${ESC}E\x01`,
  boldOff: `${ESC}E\x00`,
  doubleOn: `${GS}!\x11`,
  doubleOff: `${GS}!\x00`,
  alignLeft: `${ESC}a\x00`,
  alignCenter: `${ESC}a\x01`,
  alignRight: `${ESC}a\x02`,
  invertOn: `${GS}B\x01`,
  invertOff: `${GS}B\x00`,
  cut: `${GS}V\x42\x00`,
  // ESC p m t1 t2: pin 2, 50 ms on, 240 ms off. Every byte stays below 0x80
  // because toPrintable() turns anything higher into '?' — the classic
  // `\x19\xfa` arrived at the printer as `\x19?`.
  drawerKick: `${ESC}p\x00\x19\x78`,
  feed: (n: number) => `${ESC}d${String.fromCharCode(n)}`,
}

/** 80mm ≈ 48 chars, 58mm ≈ 32. Comes from the printer master, never guessed. */
export const colsFor = (widthMm: number): number => (widthMm >= 80 ? 48 : 32)

/**
 * Make a string safe for an ESC/POS printer.
 *
 * The output is written as latin1, so any multi-byte character is truncated to
 * a stray control byte. That silently ate the minus sign on the Z-report's
 * variance line (formatMoney uses U+2212 so figures align on screen), and would
 * mangle any accented menu item — "Crème Brûlée" is not hypothetical.
 *
 * So: fold typographic punctuation to ASCII, strip accents, and replace
 * anything still unprintable with '?' rather than emitting a control byte.
 */
export function toPrintable(text: string): string {
  return text
    .replace(/[\u2212\u2012\u2013\u2014]/g, '-')   // minus, figure/en/em dash
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')                // combining accents
    .replace(/[^\x00-\x7f]+/g, '?')   // a run (incl. surrogate pairs) is one '?'
}

export class Receipt {
  private out: string[] = []
  constructor(private readonly cols: number) {
    this.out.push(CMD.init)
  }

  raw(s: string): this {
    this.out.push(s)
    return this
  }

  line(text = ''): this {
    this.out.push(`${text}\n`)
    return this
  }

  center(text: string, bold = false): this {
    this.out.push(CMD.alignCenter)
    if (bold) this.out.push(CMD.boldOn)
    this.out.push(`${text}\n`)
    if (bold) this.out.push(CMD.boldOff)
    this.out.push(CMD.alignLeft)
    return this
  }

  big(text: string): this {
    this.out.push(CMD.alignCenter + CMD.doubleOn + `${text}\n` + CMD.doubleOff + CMD.alignLeft)
    return this
  }

  /** Inverted block — used for CANCELLED tickets so the kitchen cannot miss it. */
  banner(text: string): this {
    const padded = ` ${text} `.padStart((this.cols + text.length) / 2 + 1).padEnd(this.cols)
    this.out.push(CMD.invertOn + CMD.boldOn + `${padded}\n` + CMD.boldOff + CMD.invertOff)
    return this
  }

  rule(char = '-'): this {
    this.out.push(`${char.repeat(this.cols)}\n`)
    return this
  }

  /** Label left, value right — the only way money columns line up on paper. */
  kv(label: string, value: string, bold = false): this {
    const space = Math.max(1, this.cols - label.length - value.length)
    if (bold) this.out.push(CMD.boldOn)
    this.out.push(`${label}${' '.repeat(space)}${value}\n`)
    if (bold) this.out.push(CMD.boldOff)
    return this
  }

  /** qty × name … amount, wrapping the name rather than truncating it. */
  itemRow(qty: number, name: string, amount?: string): this {
    const q = `${qty} x `
    const amt = amount ?? ''
    const nameWidth = this.cols - q.length - amt.length - 1
    const words = name.split(' ')
    const rows: string[] = []
    let cur = ''
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > nameWidth) {
        rows.push(cur.trim())
        cur = w
      } else cur = `${cur} ${w}`
    }
    if (cur.trim()) rows.push(cur.trim())

    const first = rows.shift() ?? ''
    const pad = Math.max(1, this.cols - q.length - first.length - amt.length)
    this.out.push(`${q}${first}${' '.repeat(pad)}${amt}\n`)
    for (const r of rows) this.out.push(`${' '.repeat(q.length)}${r}\n`)
    return this
  }

  /** Modifier or note under an item line. */
  sub(text: string): this {
    this.out.push(`    - ${text}\n`)
    return this
  }

  cut(): this {
    this.out.push(CMD.feed(4) + CMD.cut)
    return this
  }

  kick(): this {
    this.out.push(CMD.drawerKick)
    return this
  }

  toBuffer(): Buffer {
    return Buffer.from(toPrintable(this.out.join('')), 'binary')
  }
}
