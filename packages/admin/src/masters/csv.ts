import type { MenuImportRow } from '../api/types'

/**
 * RFC 4180 parsing: quoted fields, "" escapes, commas and newlines inside
 * quotes, CRLF. Excel's "CSV UTF-8" export starts with a BOM, which would
 * otherwise become part of the first header name and hide the column.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/** Header spellings people actually type. Matched case- and space-insensitively. */
type Column = 'category' | 'item' | 'price' | 'kitchen'
const COLUMNS: Record<Column, string[]> = {
  category: ['category', 'categoryname', 'group'],
  item: ['item', 'itemname', 'name'],
  price: ['price', 'rate', 'amount'],
  kitchen: ['kitchen', 'kitchenname', 'kot'],
}

export type SheetResult = { rows: MenuImportRow[] } | { error: string }

/**
 * Sheet text → rows for the hub. Each row carries the spreadsheet line it came
 * from, so the hub's errors point at what the operator sees in Excel even
 * after blank lines are dropped.
 */
export function sheetToRows(text: string): SheetResult {
  const table = parseCsv(text)
  const header = table[0]
  if (!header) return { error: 'The file is empty.' }

  const norm = (h: string) => h.toLowerCase().replace(/[\s_-]/g, '')
  const index = {} as Record<Column, number>
  for (const [key, names] of Object.entries(COLUMNS) as [Column, string[]][]) {
    index[key] = header.findIndex((h) => names.includes(norm(h)))
  }
  const missing = (['category', 'item', 'price'] as const).filter((k) => index[k] === -1)
  if (missing.length > 0) {
    return { error: `The first line must name the columns. Missing: ${missing.join(', ')}.` }
  }

  const rows: MenuImportRow[] = []
  table.slice(1).forEach((cells, i) => {
    if (cells.every((c) => c.trim() === '')) return
    const at = (k: Column) => (index[k] === -1 ? '' : (cells[index[k]] ?? '').trim())
    rows.push({
      category: at('category'), item: at('item'), price: at('price'), kitchen: at('kitchen') || null, line: i + 2,
    })
  })
  if (rows.length === 0) return { error: 'The file has a header but no items.' }
  return { rows }
}

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** A starter sheet using this hub's real kitchen names, so the column is copyable. */
export function templateCsv(kitchens: string[]): string {
  const k = (i: number) => kitchens[i % Math.max(kitchens.length, 1)] ?? ''
  const lines = [
    ['category', 'item', 'price', 'kitchen'],
    ['Grills', 'Chicken Tikka', '32.00', k(0)],
    ['Grills', 'Mixed Grill', '55.00', k(0)],
    ['Juices', 'Fresh Orange', '14.00', k(1)],
    ['Juices', 'Lemon Mint', '12.00', k(1)],
  ]
  return lines.map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n'
}
