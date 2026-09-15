export type OrderType = 'dine_in' | 'takeaway' | 'car' | 'delivery'
export type OrderStatus = 'open' | 'billed' | 'settled' | 'void'

export interface Settings {
  businessName: string
  currencyDisplay: string
  currencyDecimals: number
  taxName: string
  taxRateBp: number
  taxNumberLabel: string
  taxNumberValue: string
}
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
  licence?: { state: LicenceState; plan: 'trial' | 'paid'; daysLeft: number; warning: boolean; expiresAt: string }
}

export type LicenceState = 'trial' | 'active' | 'expired'

export interface LicenceStatus {
  state: LicenceState
  plan: 'trial' | 'paid'
  customer: string | null
  installId: string
  expiresAt: string
  daysLeft: number
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
