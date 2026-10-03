/** Wire shapes from the hub. Kept narrow — the app uses far less than the DB holds. */

export type OrderType = 'dine_in' | 'takeaway' | 'car' | 'delivery'
export type OrderStatus = 'open' | 'billed' | 'settled' | 'void'
export type LineStatus = 'new' | 'sent' | 'void'

export interface Settings {
  businessName: string
  currencyDisplay: string
  currencyDecimals: number
  taxName: string
}
export interface Area { id: string; name: string; sort: number }
export interface Table { id: string; areaId: string; name: string; seats: number; sort: number }
export interface Category { id: string; name: string; kitchenId: string | null; sort: number }
export interface Item {
  id: string; categoryId: string; name: string; price: number
  isAvailable: boolean; sort: number
}
export interface Employee {
  id: string; name: string; role: 'admin' | 'waiter'
  canSaveWithoutKot: boolean; canDiscount: boolean
}
export interface Counter { id: string; name: string }
export interface ModifierGroup {
  id: string; name: string; minSelect: number; maxSelect: number; sort: number
}
export interface Modifier {
  id: string; groupId: string; name: string; priceDelta: number; sort: number
}
export interface ItemModifierGroup { itemId: string; groupId: string; sort: number }
export interface PaymentMode { id: string; name: string; type: string }

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
  itemModifierGroups: ItemModifierGroup[]
  /** Enough for a banner — the key and install id never reach a tablet. */
  licence?: { state: 'unlicensed' | 'trial' | 'active' | 'expired'; plan: 'trial' | 'paid' | null; daysLeft: number; warning: boolean; expiresAt: string | null }
}

export interface OrderLine {
  id: string
  itemId: string
  nameSnapshot: string
  unitPriceSnapshot: number
  qty: number
  note: string | null
  status: LineStatus
  kotSuppressed: boolean
  createdBy: string
  modifiers: { id: string; name: string; priceDelta: number }[]
}

export interface Order {
  id: string
  orderNo: number
  type: OrderType
  status: OrderStatus
  tableId: string | null
  ticketLabel: string | null
  vehicleNo: string | null
  bayNo: string | null
  phoneSnapshot: string | null
  addressSnapshot: string | null
  waiterId: string | null
  createdBy: string
  openedAt: string
  subtotal: number
  discountAmount: number
  taxAmount: number
  total: number
  invoiceNo: number | null
  reprintCount: number
  lines: OrderLine[]
}

export interface SendResult {
  tickets: { kitchenId: string; ticketId: string | null }[]
  seq: number
  kind: 'new' | 'addon'
  suppressed: boolean
}

/** The hub's 4xx shape — message is written for the waiter to read. */
export interface ApiErrorBody { error: string; message: string }

/** Exactly what the tablet queues when the counter is unreachable. */
export interface SubmitPayload {
  batchRef: string
  orderId?: string | null
  type: OrderType
  tableId?: string | null
  ticketLabel?: string | null
  vehicleNo?: string | null
  bayNo?: string | null
  phoneSnapshot?: string | null
  addressSnapshot?: string | null
  lines: { itemId: string; qty: number; note?: string | null; modifiers?: { id: string; name: string; priceDelta: number }[] }[]
  employeeId: string
  suppressKot?: boolean
}
