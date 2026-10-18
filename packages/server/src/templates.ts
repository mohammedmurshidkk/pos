import { formatMoney } from '@pos/shared'
import { Receipt, colsFor } from './escpos.js'

/** Payload shapes are what gets stored in print_jobs.payload_json. */
export interface KotPayload {
  kitchenName: string
  orderNo: number
  seq: number
  /** Running ticket number. Jobs queued before it existed fall back to seq. */
  kotNo?: number | null
  kind: 'new' | 'addon' | 'void'
  orderType: 'dine_in' | 'takeaway' | 'car' | 'delivery'
  tableLabel?: string | null
  ticketLabel?: string | null
  /** Order-level note, e.g. a takeaway instruction. Repeated on add-on KOTs. */
  orderNote?: string | null
  waiterName: string
  at: string
  lines: { qty: number; name: string; note?: string | null; modifiers?: string[] }[]
  voidReason?: string | null
}

export interface BillPayload {
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
  /** Asked at order time (takeaway, car, delivery) or at settle. */
  customerName?: string | null
  customerPhone?: string | null
  deliveryAddress?: string | null
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
  /** Settled in cash: pop the drawer as the paper comes out. */
  openDrawer?: boolean
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
      /** Absent on report jobs queued before expenses were itemised. */
      drawerExpenseList?: { category: string; note: string | null; amount: number }[]
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

/** Counter day close: every shift since the last day close, then the totals. */
export interface DayReportPayload {
  businessName: string
  currencyDisplay: string
  currencyDecimals: number
  taxName: string
  invoicePrefix: string
  day: {
    counterName: string
    closedBy: string | null
    closedAt: string | Date | null
    from: string | Date | null
    to: string | Date | null
    shifts: ZReportPayload['report'][]
    totals: {
      paymentModes: { name: string; count: number; total: number }[]
      grandTotal: number
      cash: {
        openingFloats: number; cashSales: number; drawerExpenses: number
        expected: number; counted: number; variance: number
      }
      expenses: { drawer: number; other: number; total: number; byCategory: { category: string; count: number; total: number }[] }
      orderTypes: { type: string; count: number; total: number }[]
      waiters: { name: string; orders: number; total: number }[]
      discounts: { count: number; total: number }
      voids: { count: number; total: number }
      savedWithoutKot: number
      vatCollected: number
      invoiceRange: { from: number | null; to: number | null; count: number }
    }
  }
}

export interface TestPayload {
  printerName: string
  ip: string
  port: number
  /** Absent on test jobs queued before USB printers existed. */
  connection?: 'network' | 'usb'
  systemName?: string | null
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
  const no = p.kotNo ?? p.seq
  if (p.kind === 'addon') r.center(`KOT #${no} (ADD-ON)`, true)
  else r.center(`KOT #${no}`, true)
  r.rule('=')

  r.kv(`Order #${p.orderNo}`, p.at)
  r.kv(TYPE_LABEL[p.orderType] ?? p.orderType, p.tableLabel ?? '')
  if (p.ticketLabel) r.kv('Ticket', p.ticketLabel)
  r.kv('Waiter', p.waiterName)
  if (p.orderNote) {
    r.rule('-')
    r.wrap(`NOTE: ${p.orderNote}`, true)
  }
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
 * The one customer document: the bill, printed as a TAX INVOICE.
 *
 * Gapless invoice number, TRN and VAT breakdown from the first print, whether
 * a waiter prints it on a tablet or the cashier at the counter. Payments are
 * listed when it is printed (or reprinted) after settlement.
 *
 * Old `print_jobs` rows may still carry `kind: 'invoice'` and an
 * `isTaxInvoice` field; they render the same way.
 */
export function renderBill(p: BillPayload, widthMm: number): Buffer {
  const cols = colsFor(widthMm)
  const r = new Receipt(cols)
  const money = (v: number) => formatMoney(v, p.currencyDecimals)

  r.center(p.businessName, true)
  if (p.addressLine) r.center(p.addressLine)
  if (p.phone) r.center(p.phone)
  if (p.taxNumberValue) r.center(`${p.taxNumberLabel}: ${p.taxNumberValue}`)
  r.line()
  r.center('TAX INVOICE', true)

  if (p.reprintCount > 0) {
    r.center(p.wasEditedAfterPrint ? 'REVISED' : `REPRINT #${p.reprintCount + 1}`, true)
  }
  r.rule('=')

  if (p.invoiceNo) r.kv('Invoice', p.invoiceNo)
  r.kv('Order', `#${p.orderNo}`)
  r.kv('Date', p.at)
  r.kv(TYPE_LABEL[p.orderType] ?? p.orderType, p.tableLabel ?? '')
  if (p.customerName) r.kv('Customer', p.customerName)
  // Delivery already shows the phone as its label above.
  if (p.customerPhone && p.customerPhone !== p.tableLabel) r.kv('Phone', p.customerPhone)
  if (p.deliveryAddress) r.line(`Deliver to: ${p.deliveryAddress}`)
  r.kv('Waiter', p.waiterName)
  r.kv('Counter', p.counterName)
  r.rule('-')

  for (const l of p.lines) {
    r.itemRow(l.qty, l.name, money(l.amount))
    for (const m of l.modifiers ?? []) r.sub(m)
    // No kitchen note here: "no onion" is for the cook. The bill is the
    // customer's tax invoice, and the note only prints on the KOT.
  }

  r.rule('-')
  r.kv('Subtotal', money(p.subtotal))
  if (p.discountAmount > 0) r.kv('Discount', `-${money(p.discountAmount)}`)
  if (p.serviceCharge > 0) r.kv('Service Charge', money(p.serviceCharge))
  r.kv('Net', money(p.net))
  r.kv(`${p.taxName} ${p.taxRatePct}%`, money(p.tax))
  r.rule('=')
  r.kv('TOTAL', `${p.currencyDisplay} ${money(p.total)}`, true)

  if (p.payments?.length) {
    r.rule('-')
    for (const pay of p.payments) r.kv(pay.name, money(pay.amount))
  }

  r.line()
  if (p.footer) r.center(p.footer)
  if (p.openDrawer) r.kick()
  return r.cut().toBuffer()
}

export function renderTest(p: TestPayload, widthMm: number): Buffer {
  const cols = colsFor(widthMm)
  const r = new Receipt(cols)
  r.big('TEST PRINT')
  r.rule('=')
  r.kv('Printer', p.printerName)
  r.kv('Address', p.connection === 'usb' ? `USB - ${p.systemName ?? ''}` : `${p.ip}:${p.port}`)
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
  // One line per payout — category, then the note — so a shortage can be
  // checked against what was actually paid for.
  for (const e of z.cash.drawerExpenseList ?? []) {
    expenseRow(r, cols, `${e.category}${e.note ? `: ${e.note}` : ''}`, m(e.amount))
  }
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

/**
 * Day close report. One section per shift (who, when, sales, cash), so the
 * owner can see which shift was short, then the counter's totals for the day.
 */
export function renderDayReport(p: DayReportPayload, widthMm: number): Buffer {
  const cols = colsFor(widthMm)
  const r = new Receipt(cols)
  // A payload missing a field (queued by an older hub) prints a dash, never NaN.
  const m = (v: number | null | undefined) =>
    typeof v === 'number' && Number.isFinite(v) ? formatMoney(v, p.currencyDecimals) : '-'
  const when = (d: string | Date | null) =>
    d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '-'
  const d = p.day
  const t = d.totals

  r.center(p.businessName, true)
  r.big('DAY CLOSE')
  r.rule('=')
  r.kv('Counter', d.counterName)
  r.kv('From', when(d.from))
  r.kv('To', when(d.to))
  r.kv('Shifts', String(d.shifts.length))
  if (d.closedBy) r.kv('Closed by', d.closedBy)
  r.rule('=')

  d.shifts.forEach((z, i) => {
    r.line(`SHIFT ${i + 1} - ${z.cashierName}`)
    r.kv('  Opened', when(z.openedAt))
    r.kv('  Closed', when(z.closedAt))
    for (const pm of z.paymentModes) r.kv(`  ${pm.name} (${pm.count})`, m(pm.total))
    r.kv('  Sales', m(z.grandTotal), true)
    r.kv('  Opening float', m(z.cash.openingFloat))
    r.kv('  + Cash sales', m(z.cash.cashSales))
    r.kv('  - Expenses from drawer', m(z.cash.drawerExpenses))
    r.kv('  Expected in drawer', m(z.cash.expected))
    r.kv('  Counted', z.cash.counted == null ? '-' : m(z.cash.counted))
    r.kv('  Variance', z.cash.variance == null ? '-' : m(z.cash.variance), true)
    r.rule('-')
  })

  r.line()
  r.center('COUNTER TOTALS', true)
  r.rule('=')
  r.line('SALES BY PAYMENT MODE')
  for (const pm of t.paymentModes) r.kv(`  ${pm.name} (${pm.count})`, m(pm.total))
  r.rule('-')
  r.kv('  TOTAL SALES', m(t.grandTotal), true)
  r.line()

  r.line('EXPENSES')
  for (const e of t.expenses.byCategory) r.kv(`  ${e.category} (${e.count})`, m(e.total))
  r.kv('  From drawer', m(t.expenses.drawer))
  r.kv('  Not from drawer', m(t.expenses.other))
  r.rule('-')
  r.kv('  TOTAL EXPENSES', m(t.expenses.total), true)
  r.line()

  r.line('CASH (ALL SHIFTS)')
  r.kv('  Opening floats', m(t.cash.openingFloats))
  r.kv('  + Cash sales', m(t.cash.cashSales))
  r.kv('  - Expenses from drawer', m(t.cash.drawerExpenses))
  r.rule('-')
  r.kv('  Expected', m(t.cash.expected))
  r.kv('  Counted', m(t.cash.counted))
  r.kv('  VARIANCE', m(t.cash.variance), true)
  r.line()

  r.line('SALES BY ORDER TYPE')
  for (const o of t.orderTypes) r.kv(`  ${o.type} (${o.count})`, m(o.total))
  r.line()

  if (t.waiters.length) {
    r.line('SALES BY WAITER')
    for (const w of t.waiters) r.kv(`  ${w.name} (${w.orders})`, m(w.total))
    r.line()
  }

  r.rule('=')
  r.kv(`Discounts (${t.discounts.count})`, m(t.discounts.total))
  r.kv(`Voids (${t.voids.count})`, m(t.voids.total))
  r.kv('Saved without KOT', String(t.savedWithoutKot))
  r.kv(`${p.taxName} collected`, m(t.vatCollected))
  r.kv(
    'Invoices',
    t.invoiceRange.from == null
      ? 'none'
      : `${p.invoicePrefix}${t.invoiceRange.from} - ${p.invoicePrefix}${t.invoiceRange.to}`,
  )
  r.rule('=')
  return r.cut().toBuffer()
}

/** Dispatch used by the print queue. */
/** An itemised expense under the drawer total, wrapping a long note. */
function expenseRow(r: Receipt, cols: number, text: string, amount: string) {
  const indent = '      '
  const width = cols - indent.length - amount.length - 1
  const rows: string[] = []
  let cur = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    // A single word longer than the column is cut rather than overflowing.
    const word = w.length > width ? w.slice(0, width) : w
    if (cur && `${cur} ${word}`.length > width) {
      rows.push(cur)
      cur = word
    } else cur = cur ? `${cur} ${word}` : word
  }
  if (cur) rows.push(cur)
  const first = rows.shift() ?? ''
  r.line(`${indent}${first}${' '.repeat(Math.max(1, cols - indent.length - first.length - amount.length))}${amount}`)
  for (const row of rows) r.line(`${indent}  ${row}`)
}

export function renderJob(kind: string, payload: unknown, widthMm: number): Buffer {
  switch (kind) {
    case 'kot':
    case 'void':
      return renderKot(payload as KotPayload, widthMm)
    case 'bill':
    case 'invoice':
      return renderBill(payload as BillPayload, widthMm)
    case 'drawer':
      // Cash taken against a bill already printed: open the drawer, no paper.
      return new Receipt(colsFor(widthMm)).kick().toBuffer()
    case 'report':
      // A day close shares the kind; only its payload carries `day`.
      return (payload as Partial<DayReportPayload>).day
        ? renderDayReport(payload as DayReportPayload, widthMm)
        : renderZReport(payload as ZReportPayload, widthMm)
    case 'test':
      return renderTest(payload as TestPayload, widthMm)
    default:
      throw new Error(`unknown print job kind: ${kind}`)
  }
}
