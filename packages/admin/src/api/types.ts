export type OrderType = 'dine_in' | 'takeaway' | 'car' | 'delivery'
export type OrderStatus = 'open' | 'billed' | 'settled' | 'void'

/**
 * The settings row as /api/bootstrap returns it (licence fields stripped).
 * The editable subset mirrors `settingsSchema` in the server's masters service.
 */
export interface Settings {
  businessName: string
  addressLine: string
  phone: string
  receiptFooter: string
  countryCode: string
  currencyCode: string
  currencyDisplay: string
  currencyDecimals: number
  taxName: string
  /** Basis points: 5% is 500. */
  taxRateBp: number
  taxNumberLabel: string
  taxNumberValue: string
  priceIncludesTax: boolean
  serviceChargeBp: number
  invoicePrefix: string
  invoiceNextNo: number
  businessDayStartHour: number
  defaultKitchenId: string | null
  requirePinOnAction: boolean
}

/** What PATCH /api/settings accepts — invoice numbering is never editable. */
export type SettingsPatch = Partial<Omit<Settings, 'invoiceNextNo'>>
export interface Kitchen { id: string; name: string; printerId: string; active: boolean }
export interface Area { id: string; name: string; sort: number }
export interface Table { id: string; areaId: string; name: string; seats: number; sort: number }
export interface Category { id: string; name: string; kitchenId: string | null; sort: number }
export interface Item { id: string; categoryId: string; name: string; price: number; isAvailable: boolean; sort: number }
export interface Employee {
  id: string; name: string; role: 'admin' | 'waiter'
  canSaveWithoutKot: boolean; canDiscount: boolean
  /** Whether a PIN is set — the hash itself never leaves the hub. */
  hasPin?: boolean
}
export interface ModifierGroup { id: string; name: string; minSelect: number; maxSelect: number; sort: number }
export interface Modifier { id: string; groupId: string; name: string; priceDelta: number; sort: number }
export interface Counter { id: string; name: string }
export interface PaymentMode {
  id: string; name: string; type: string; merchantName: string | null
  requiresRef: boolean; opensCashDrawer: boolean; countsInCashClosing: boolean
}

export interface Bootstrap {
  settings: Settings
  areas: Area[]
  tables: Table[]
  categories: Category[]
  items: Item[]
  employees: Employee[]
  counters: Counter[]
  paymentModes: PaymentMode[]
  modifierGroups: ModifierGroup[]
  modifiers: Modifier[]
  itemModifierGroups: { itemId: string; groupId: string; sort: number }[]
  licence?: { state: LicenceState; plan: 'trial' | 'paid' | null; daysLeft: number; msLeft: number; warning: boolean; expiresAt: string | null }
}

/** `unlicensed`: a fresh install — no trial granted, no key. Blocks new orders like `expired`. */
export type LicenceState = 'unlicensed' | 'trial' | 'active' | 'expired'

export interface LicenceStatus {
  state: LicenceState
  plan: 'trial' | 'paid' | null
  customer: string | null
  installId: string
  expiresAt: string | null
  daysLeft: number
  msLeft: number
  warning: boolean
  clockRolledBack: boolean
}

export interface Device {
  id: string
  name: string
  type: string
  lastSeen: string | null
  active: boolean
  createdAt: string
}

export interface OrderLine {
  id: string; itemId: string; nameSnapshot: string; unitPriceSnapshot: number
  qty: number; note: string | null; status: 'new' | 'sent' | 'void'
  kotSuppressed: boolean; createdBy: string
  modifiers: { id: string; name: string; priceDelta: number }[]
}

export interface Order {
  id: string; orderNo: number; type: OrderType; status: OrderStatus
  tableId: string | null; ticketLabel: string | null
  vehicleNo: string | null; phoneSnapshot: string | null
  customerId: string | null; customerName: string | null; addressSnapshot: string | null
  billedAt: string | null
  waiterId: string | null; createdBy: string; openedAt: string
  subtotal: number; discountAmount: number; discountType: string
  serviceCharge: number; taxAmount: number; total: number
  invoiceNo: number | null; reprintCount: number
  /** Lines or discount changed since the bill last printed — settling reprints it as REVISED. */
  dirtySincePrint: boolean
  lines: OrderLine[]
}

export interface Printer {
  id: string; name: string; ip: string; port: number
  width: number; enabled: boolean; online: boolean
  /** `usb`: installed in Windows on the counter PC, `systemName` is its name there. */
  connection: 'network' | 'usb'; systemName: string | null
  /** Why it is red, when the hub knows ("Windows reports: PaperOut"). */
  statusDetail: string | null
}

/** One row of the print queue, as the counter's queue panel shows it. */
export interface PrintJob {
  id: string; printerId: string; printerName: string
  kind: string; kindLabel: string
  /** What staff recognise it by: kitchen, invoice, order and table. */
  detail: string
  status: 'pending' | 'printing' | 'done' | 'failed' | 'discarded'
  attempts: number; lastError: string | null
  createdAt: string; completedAt: string | null
}

export interface BackupFile { name: string; bytes: number; createdAt: string }

export interface BackupStatus {
  dir: string
  /** True when the folder was chosen in Settings rather than the default. */
  custom: boolean
  lastBackupAt: string | null
  /** Nothing in the last 24 hours. */
  overdue: boolean
  retentionDays: number
  count: number
  totalBytes: number
  recent: BackupFile[]
  lastError: { at: string; message: string } | null
}

export interface ZReport {
  shiftId: string; counterName: string; cashierName: string
  openedAt: string; closedAt: string | null
  paymentModes: { name: string; type: string; count: number; total: number }[]
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

/** One spreadsheet row as POST /api/masters/menu/import accepts it. */
export interface MenuImportRow {
  category: string; item: string; price: string; kitchen?: string | null
  /** Spreadsheet line — the hub reports problems against it. */
  line?: number
}

/** Mirrors `MenuImportPlan` in the server's menu-import service. */
export interface MenuImportPlan {
  categoriesToCreate: { name: string; kitchen: string | null }[]
  itemsToCreate: { category: string; name: string; price: number }[]
  itemsToUpdate: { category: string; name: string; from: number; to: number }[]
  unchanged: number
  /** `row` is the spreadsheet line when rows carry `line`. */
  errors: { row: number; message: string }[]
  warnings: { row: number; message: string }[]
  applied: boolean
}

export type RangePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom'
export interface RangeQuery { preset: RangePreset; from?: string; to?: string }
export interface RangeResult { from: string; to: string; label: string }

export interface ExpenseCategory { id: string; name: string; active: boolean }
export interface Expense {
  id: string; amount: number; note: string | null; paidFromDrawer: boolean
  shiftId: string | null; createdAt: string
  categoryId: string; category: string; paidBy: string
}

/** A settled or cancelled order, with what was paid against it. */
export interface ClosedOrder extends Order {
  settledAt: string | null
  payments: { amount: number; refNo: string | null; mode: string }[]
}

/** What POST /api/orders/submit takes — one idempotent create + add + send. */
export interface SubmitOrder {
  batchRef: string
  orderId?: string | null
  type: OrderType
  tableId?: string | null
  ticketLabel?: string | null
  vehicleNo?: string | null
  bayNo?: string | null
  phoneSnapshot?: string | null
  addressSnapshot?: string | null
  customerName?: string | null
  lines: { itemId: string; qty: number; note: string | null; modifiers: { id: string; name: string; priceDelta: number }[] }[]
  employeeId: string
  suppressKot?: boolean
}

/** One customer per phone number. Addresses newest first. */
export interface Customer {
  id: string; name: string; phone: string
  addresses: string[]
  orderCount: number; lastOrderAt: string | null
}
