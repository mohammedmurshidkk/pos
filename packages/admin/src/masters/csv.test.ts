import { describe, expect, it } from 'vitest'
import { parseCsv, sheetToRows, templateCsv } from './csv'

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ])
  })

  it('keeps a newline inside a quoted field', () => {
    expect(parseCsv('"two\nlines",x')).toEqual([['two\nlines', 'x']])
  })

  it('strips the BOM Excel writes', () => {
    expect(parseCsv('﻿category,item')[0]![0]).toBe('category')
  })
})

describe('sheetToRows', () => {
  it('maps columns by header in any order and spelling', () => {
    const r = sheetToRows('Item Name,Price,KITCHEN,Category\nTea,3.00,Juice Corner,Drinks\n')
    expect(r).toEqual({
      rows: [{ category: 'Drinks', item: 'Tea', price: '3.00', kitchen: 'Juice Corner', line: 2 }],
    })
  })

  it('treats the kitchen column as optional', () => {
    const r = sheetToRows('category,item,price\nDrinks,Tea,3\n')
    expect('rows' in r && r.rows[0]!.kitchen).toBe(null)
  })

  it('skips blank lines but reports the real spreadsheet line', () => {
    const r = sheetToRows('category,item,price\n\nA,x,1\n,,\nA,y,2\n')
    expect('rows' in r && r.rows.map((x) => x.line)).toEqual([3, 5])
  })

  it('says which required columns are missing', () => {
    expect(sheetToRows('category,name\nA,b')).toEqual({
      error: 'The first line must name the columns. Missing: price.',
    })
  })

  it('round-trips its own template', () => {
    const r = sheetToRows(templateCsv(['Arabic Kitchen', 'Juice Corner']))
    expect('rows' in r && r.rows.map((x) => x.kitchen)).toEqual([
      'Arabic Kitchen', 'Arabic Kitchen', 'Juice Corner', 'Juice Corner',
    ])
  })
})
