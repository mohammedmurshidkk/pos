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
}

export interface PrintJob {
  id: string; printerId: string; kind: string; status: string
  attempts: number; lastError: string | null; createdAt: string
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
