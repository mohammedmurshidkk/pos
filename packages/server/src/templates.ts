import { formatMoney } from '@pos/shared'
import { Receipt, colsFor } from './escpos.js'

/** Payload shapes are what gets stored in print_jobs.payload_json. */
export interface KotPayload {
  kitchenName: string
  orderNo: number
  seq: number
  kind: 'new' | 'addon' | 'void'
  orderType: 'dine_in' | 'takeaway' | 'car' | 'delivery'
  tableLabel?: string | null
  ticketLabel?: string | null
  waiterName: string
  at: string
  lines: { qty: number; name: string; note?: string | null; modifiers?: string[] }[]
  voidReason?: string | null
}

export interface BillPayload {
  isTaxInvoice: boolean
  businessName: string
  addressLine: string
  phone: string
  taxNumberLabel: string
  taxNumberValue: string
  taxName: string
  taxRatePct: number
  currencyDisplay: string
  currencyDecimals: number
  invoiceNo?: string | null
  orderNo: number
  orderType: string
  tableLabel?: string | null
  waiterName: string
  counterName: string
  at: string
  reprintCount: number
  wasEditedAfterPrint: boolean
  lines: { qty: number; name: string; amount: number; modifiers?: string[]; note?: string | null }[]
  subtotal: number
  discountAmount: number
  serviceCharge: number
  net: number
  tax: number
  total: number
  payments?: { name: string; amount: number }[]
  footer: string
}

export interface ZReportPayload {
  businessName: string
  currencyDisplay: string
  currencyDecimals: number
  taxName: string
  invoicePrefix: string
  report: {
    counterName: string
    cashierName: string
    openedAt: string | Date
    closedAt: string | Date | null
    paymentModes: { name: string; count: number; total: number }[]
    grandTotal: number
    cash: {
      openingFloat: number; cashSales: number; drawerExpenses: number
      expected: number; counted: number | null; variance: number | null
    }
    orderTypes: { type: string; count: number; total: number }[]
    waiters: { name: string; orders: number; total: number }[]
    discounts: { count: number; total: number }
    voids: { count: number; total: number }
    savedWithoutKot: number
    vatCollected: number
    invoiceRange: { from: number | null; to: number | null; count: number }
  }
}

export interface TestPayload {
  printerName: string
  ip: string
  port: number
  at: string
}

const TYPE_LABEL: Record<string, string> = {
  dine_in: 'DINE-IN',
  takeaway: 'TAKEAWAY',
  car: 'CAR',
  delivery: 'DELIVERY',
}

/**
 * Kitchen ticket. The header carries table and waiter because that is how
 * kitchen staff and runners navigate — not by order id.
 */
export function renderKot(p: KotPayload, widthMm: number): Buffer {
  const r = new Receipt(colsFor(widthMm))

  if (p.kind === 'void') r.banner('*** CANCELLED ***')
  r.big(p.kitchenName)
  if (p.kind === 'addon') r.center(`KOT #${p.seq} (ADD-ON)`, true)
  else r.center(`KOT #${p.seq}`, true)
  r.rule('=')

  r.kv(`Order #${p.orderNo}`, p.at)
  r.kv(TYPE_LABEL[p.orderType] ?? p.orderType, p.tableLabel ?? '')
  if (p.ticketLabel) r.kv('Ticket', p.ticketLabel)
  r.kv('Waiter', p.waiterName)
  r.rule('=')

  for (const l of p.lines) {
    r.itemRow(l.qty, l.name.toUpperCase())
    for (const m of l.modifiers ?? []) r.sub(m)
    if (l.note) r.sub(`NOTE: ${l.note}`)
  }

  r.rule('=')
  if (p.kind === 'void') {
    r.banner('DO NOT PREPARE')
    if (p.voidReason) r.center(`Reason: ${p.voidReason}`)
  }
  return r.cut().toBuffer()
}

/**
 * Customer document. Two shapes from one template:
 *   BILL        — no invoice number, printed from tablet or counter, reprintable
 *   TAX INVOICE — gapless number, TRN, issued at settlement
 */
export function renderBill(p: BillPayload, widthMm: number): Buffer {
  const cols = colsFor(widthMm)
  const r = new Receipt(cols)
  const money = (v: number) => formatMoney(v, p.currencyDecimals)

  r.center(p.businessName, true)
  if (p.addressLine) r.center(p.addressLine)
  if (p.phone) r.center(p.phone)
  if (p.isTaxInvoice && p.taxNumberValue) r.center(`${p.taxNumberLabel}: ${p.taxNumberValue}`)
  r.line()
  r.center(p.isTaxInvoice ? 'TAX INVOICE' : 'BILL', true)

  if (p.reprintCount > 0) {
    r.center(p.wasEditedAfterPrint ? 'REVISED' : `REPRINT #${p.reprintCount + 1}`, true)
  }
  r.rule('=')

  if (p.invoiceNo) r.kv('Invoice', p.invoiceNo)
  r.kv('Order', `#${p.orderNo}`)
  r.kv('Date', p.at)
  r.kv(TYPE_LABEL[p.orderType] ?? p.orderType, p.tableLabel ?? '')
  r.kv('Waiter', p.waiterName)
  r.kv('Counter', p.counterName)
  r.rule('-')

  for (const l of p.lines) {
    r.itemRow(l.qty, l.name, money(l.amount))
    for (const m of l.modifiers ?? []) r.sub(m)
    if (l.note) r.sub(l.note)
  }

  r.rule('-')
  r.kv('Subtotal', money(p.subtotal))
  if (p.discountAmount > 0) r.kv('Discount', `-${money(p.discountAmount)}`)
  if (p.serviceCharge > 0) r.kv('Service Charge', money(p.serviceCharge))
  if (p.isTaxInvoice) {
    r.kv('Net', money(p.net))
    r.kv(`${p.taxName} ${p.taxRatePct}%`, money(p.tax))
  }
  r.rule('=')
  r.kv('TOTAL', `${p.currencyDisplay} ${money(p.total)}`, true)

  if (p.payments?.length) {
    r.rule('-')
    for (const pay of p.payments) r.kv(pay.name, money(pay.amount))
  }

  r.line()
  if (p.footer) r.center(p.footer)
  if (!p.isTaxInvoice) r.center('Not a tax invoice - please settle at the counter')
  return r.cut().toBuffer()
}

export function renderTest(p: TestPayload, widthMm: number): Buffer {
  const cols = colsFor(widthMm)
  const r = new Receipt(cols)
  r.big('TEST PRINT')
  r.rule('=')
  r.kv('Printer', p.printerName)
  r.kv('Address', `${p.ip}:${p.port}`)
  r.kv('Width', `${widthMm}mm / ${cols} cols`)
  r.kv('Time', p.at)
  r.rule('=')
  // Column ruler — makes a wrong paper-width setting obvious at a glance.
  r.line('1234567890'.repeat(Math.ceil(cols / 10)).slice(0, cols))
  r.line()
  r.center('If this line is centered and the')
  r.center('ruler above fills the paper exactly,')
  r.center('the width setting is correct.')
  return r.cut().toBuffer()
}

/**
 * Z-report. The screen and the paper the owner judges you on, so it carries
 * everything an auditor or a suspicious owner asks for — including the invoice
 * range and what was saved without a KOT.
 */
export function renderZReport(p: ZReportPayload, widthMm: number): Buffer {
  const cols = colsFor(widthMm)
  const r = new Receipt(cols)
  const m = (v: number) => formatMoney(v, p.currencyDecimals)
  const when = (d: string | Date | null) =>
    d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '-'
  const z = p.report

  r.center(p.businessName, true)
  r.big('Z-REPORT')
  r.rule('=')
  r.kv('Counter', z.counterName)
  r.kv('Cashier', z.cashierName)
  r.kv('Opened', when(z.openedAt))
  r.kv('Closed', when(z.closedAt))
  r.rule('=')

  r.line('SALES BY PAYMENT MODE')
  for (const pm of z.paymentModes) r.kv(`  ${pm.name} (${pm.count})`, m(pm.total))
  r.rule('-')
  r.kv('  TOTAL', m(z.grandTotal), true)
  r.line()

  r.line('CASH RECONCILIATION')
  r.kv('  Opening float', m(z.cash.openingFloat))
  r.kv('  + Cash sales', m(z.cash.cashSales))
  r.kv('  - Expenses from drawer', m(z.cash.drawerExpenses))
  r.rule('-')
  r.kv('  Expected in drawer', m(z.cash.expected), true)
  r.kv('  Counted', z.cash.counted == null ? '-' : m(z.cash.counted))
  r.kv('  VARIANCE', z.cash.variance == null ? '-' : m(z.cash.variance), true)
  r.line()

  r.line('SALES BY ORDER TYPE')
  for (const t of z.orderTypes) r.kv(`  ${t.type} (${t.count})`, m(t.total))
  r.line()

  if (z.waiters.length) {
    r.line('SALES BY WAITER')
    for (const w of z.waiters) r.kv(`  ${w.name} (${w.orders})`, m(w.total))
    r.line()
  }

  r.rule('=')
  r.kv(`Discounts (${z.discounts.count})`, m(z.discounts.total))
  r.kv(`Voids (${z.voids.count})`, m(z.voids.total))
  r.kv('Saved without KOT', String(z.savedWithoutKot))
  r.kv(`${p.taxName} collected`, m(z.vatCollected))
  r.kv(
    'Invoices',
    z.invoiceRange.from == null
      ? 'none'
      : `${p.invoicePrefix}${z.invoiceRange.from} - ${p.invoicePrefix}${z.invoiceRange.to}`,
  )
  r.rule('=')
  return r.cut().toBuffer()
}

/** Dispatch used by the print queue. */
export function renderJob(kind: string, payload: unknown, widthMm: number): Buffer {
  switch (kind) {
    case 'kot':
    case 'void':
      return renderKot(payload as KotPayload, widthMm)
    case 'bill':
    case 'invoice':
      return renderBill(payload as BillPayload, widthMm)
    case 'report':
      return renderZReport(payload as ZReportPayload, widthMm)
    case 'test':
      return renderTest(payload as TestPayload, widthMm)
    default:
      throw new Error(`unknown print job kind: ${kind}`)
  }
}
