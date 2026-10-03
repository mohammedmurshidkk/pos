import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Hub database — SQLite (WAL). Single branch, single source of truth.
 *
 * Conventions, all load-bearing:
 *   · ids are UUIDv7 text — generated offline on any device, time-sortable
 *   · money is INTEGER in minor units (AED 25.50 → 2550). Never REAL.
 *   · booleans are INTEGER 0/1
 *   · timestamps are INTEGER epoch-ms
 *   · nothing is ever deleted — soft-delete via `active` or a void record
 */

const id = () => text('id').primaryKey()
/**
 * Millisecond precision, supplied by the application.
 *
 * SQLite's `unixepoch()` truncates to whole seconds, so a row written in the
 * same second a shift opens could sort BEFORE `opened_at` and vanish from the
 * Z-report window. There is deliberately no SQL default: Drizzle skips the
 * column entirely when one exists, and the truncated value wins.
 */
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
const active = () => integer('active', { mode: 'boolean' }).notNull().default(true)
const sort = () => integer('sort').notNull().default(0)

/* ────────────────────────────── masters ────────────────────────────── */

export const printers = sqliteTable('printers', {
  id: id(),
  name: text('name').notNull(),
  ip: text('ip').notNull(),
  port: integer('port').notNull().default(9100),
  /** 58 or 80 mm. Drives characters-per-line in the ESC/POS renderer. */
  width: integer('width').notNull().default(80),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
})

/** A prep point: "Arabic Kitchen", "Chinese Kitchen", "Juice Corner". */
export const kitchens = sqliteTable('kitchens', {
  id: id(),
  name: text('name').notNull(),
  nameAr: text('name_ar'),
  printerId: text('printer_id').notNull().references(() => printers.id),
  active: active(),
  createdAt: createdAt(),
})

/** A till. Invoices print here. Shifts and payments are stamped with it. */
export const counters = sqliteTable('counters', {
  id: id(),
  name: text('name').notNull(),
  printerId: text('printer_id').notNull().references(() => printers.id),
  active: active(),
  createdAt: createdAt(),
})

export const categories = sqliteTable('categories', {
  id: id(),
  name: text('name').notNull(),
  nameAr: text('name_ar'),
  /** Null → falls back to settings.defaultKitchenId. Never drop a KOT. */
  kitchenId: text('kitchen_id').references(() => kitchens.id),
  sort: sort(),
  active: active(),
  createdAt: createdAt(),
})

export const items = sqliteTable(
  'items',
  {
    id: id(),
    categoryId: text('category_id').notNull().references(() => categories.id),
    name: text('name').notNull(),
    nameAr: text('name_ar'),
    /** Minor units. Gross or net depending on settings.priceIncludesTax. */
    price: integer('price').notNull(),
    /** 86'ing an item during service must be one tap. */
    isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true),
    sort: sort(),
    active: active(),
    createdAt: createdAt(),
  },
  (t) => ({ byCategory: index('items_category_idx').on(t.categoryId) }),
)

export const modifierGroups = sqliteTable('modifier_groups', {
  id: id(),
  name: text('name').notNull(),
  minSelect: integer('min_select').notNull().default(0),
  maxSelect: integer('max_select').notNull().default(1),
  sort: sort(),
  active: active(),
})

export const modifiers = sqliteTable('modifiers', {
  id: id(),
  groupId: text('group_id').notNull().references(() => modifierGroups.id),
  name: text('name').notNull(),
  /** Minor units, per unit of the parent item. May be 0. */
  priceDelta: integer('price_delta').notNull().default(0),
  sort: sort(),
  active: active(),
})

export const itemModifierGroups = sqliteTable(
  'item_modifier_groups',
  {
    itemId: text('item_id').notNull().references(() => items.id),
    groupId: text('group_id').notNull().references(() => modifierGroups.id),
    sort: sort(),
  },
  (t) => ({ pk: uniqueIndex('img_pk').on(t.itemId, t.groupId) }),
)

export const areas = sqliteTable('areas', {
  id: id(),
  name: text('name').notNull(),
  sort: sort(),
  active: active(),
})

export const tables = sqliteTable(
  'tables',
  {
    id: id(),
    areaId: text('area_id').notNull().references(() => areas.id),
    name: text('name').notNull(),
    seats: integer('seats').notNull().default(4),
    sort: sort(),
    active: active(),
  },
  (t) => ({ byArea: index('tables_area_idx').on(t.areaId) }),
)

export const employees = sqliteTable('employees', {
  id: id(),
  name: text('name').notNull(),
  role: text('role', { enum: ['admin', 'waiter'] }).notNull(),
  /** Used by the admin PC only. The tablet picker does not ask for it. */
  pinHash: text('pin_hash'),
  canDiscount: integer('can_discount', { mode: 'boolean' }).notNull().default(false),
  maxDiscountPercent: integer('max_discount_percent').notNull().default(0),
  /** Default on for admin, off for waiter. */
  canSaveWithoutKot: integer('can_save_without_kot', { mode: 'boolean' }).notNull().default(false),
  active: active(),
  createdAt: createdAt(),
})

/** Flat tender list — "Cash", "SBI Card", "Canara Card". One tap for the cashier. */
export const paymentModes = sqliteTable('payment_modes', {
  id: id(),
  name: text('name').notNull(),
  type: text('type', { enum: ['cash', 'card', 'wallet', 'credit', 'online'] }).notNull(),
  merchantName: text('merchant_name'),
  terminalId: text('terminal_id'),
  requiresRef: integer('requires_ref', { mode: 'boolean' }).notNull().default(false),
  opensCashDrawer: integer('opens_cash_drawer', { mode: 'boolean' }).notNull().default(false),
  /** Only cash counts toward the physical drawer count at shift close. */
  countsInCashClosing: integer('counts_in_cash_closing', { mode: 'boolean' }).notNull().default(false),
  sort: sort(),
  active: active(),
})

export const expenseCategories = sqliteTable('expense_categories', {
  id: id(),
  name: text('name').notNull(),
  active: active(),
})

export const devices = sqliteTable('devices', {
  id: id(),
  name: text('name').notNull(),
  type: text('type', { enum: ['tablet', 'counter_pc'] }).notNull(),
  pairToken: text('pair_token').notNull(),
  /** Tablet: preselected in the print-bill sheet. Counter PC: fixed, never prompts. */
  defaultCounterId: text('default_counter_id').references(() => counters.id),
  lastSeen: integer('last_seen', { mode: 'timestamp_ms' }),
  active: active(),
  createdAt: createdAt(),
})

/** Single row, id = 'singleton'. Nothing hardcodes 5% or AED anywhere else. */
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey().default('singleton'),
  businessName: text('business_name').notNull().default(''),
  addressLine: text('address_line').notNull().default(''),
  phone: text('phone').notNull().default(''),
  logoPath: text('logo_path'),
  receiptFooter: text('receipt_footer').notNull().default(''),

  countryCode: text('country_code').notNull().default('AE'),
  currencyCode: text('currency_code').notNull().default('AED'),
  /** Text printed on receipts. Never print ₹ — most ESC/POS codepages lack it. */
  currencyDisplay: text('currency_display').notNull().default('AED'),
  currencyDecimals: integer('currency_decimals').notNull().default(2),

  taxName: text('tax_name').notNull().default('VAT'),
  /** Stored ×100 so the rate itself is an integer: 5% → 500. */
  taxRateBp: integer('tax_rate_bp').notNull().default(500),
  taxNumberLabel: text('tax_number_label').notNull().default('TRN'),
  taxNumberValue: text('tax_number_value').notNull().default(''),
  priceIncludesTax: integer('price_includes_tax', { mode: 'boolean' }).notNull().default(true),
  serviceChargeBp: integer('service_charge_bp').notNull().default(0),

  invoicePrefix: text('invoice_prefix').notNull().default('INV-'),
  invoiceNextNo: integer('invoice_next_no').notNull().default(1),
  orderNextNo: integer('order_next_no').notNull().default(1),

  /**
   * Hour the business day rolls over, 0-23. A restaurant that closes at 02:00
   * wants those sales on the previous day's report — with 0 the owner sees two
   * wrong days instead of one right one.
   */
  businessDayStartHour: integer('business_day_start_hour').notNull().default(0),

  defaultKitchenId: text('default_kitchen_id').references(() => kitchens.id),
  /** Dormant seam. When true the tablet picker demands a PIN. Not built in MVP. */
  requirePinOnAction: integer('require_pin_on_action', { mode: 'boolean' }).notNull().default(false),

  lastBackupAt: integer('last_backup_at', { mode: 'timestamp_ms' }),

  /**
   * Licence state. The install id is what a licence is signed against. It lives
   * in the database rather than being derived from hardware on purpose: when the
   * shop's PC dies, restoring a shift-close backup onto a new machine must bring
   * the licence with it, not lock a restaurant out mid-week.
   */
  installId: text('install_id'),
  trialStartedAt: integer('trial_started_at', { mode: 'timestamp_ms' }),
  licenceKey: text('licence_key'),
  /** Latest time ever observed — winding the PC clock back cannot rewind expiry. */
  clockHighWater: integer('clock_high_water', { mode: 'timestamp_ms' }),

  /**
   * Superadmin password (scrypt). The recovery door: when every admin PIN is
   * lost there is no other way back in, because admins can only be created from
   * inside the app. Never a shared constant — set per installation, and
   * resettable from the PC itself with `pnpm superadmin:set`.
   */
  superadminHash: text('superadmin_hash'),
})

/* ──────────────────────────── transactions ──────────────────────────── */

export const customers = sqliteTable(
  'customers',
  {
    id: id(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({ byPhone: uniqueIndex('customers_phone_idx').on(t.phone) }),
)

export const customerAddresses = sqliteTable('customer_addresses', {
  id: id(),
  customerId: text('customer_id').notNull().references(() => customers.id),
  label: text('label').notNull().default('Home'),
  area: text('area'),
  building: text('building'),
  flat: text('flat'),
  landmark: text('landmark'),
  notes: text('notes'),
})

export const shifts = sqliteTable('shifts', {
  id: id(),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  counterId: text('counter_id').notNull().references(() => counters.id),
  openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull(),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
  openingFloat: integer('opening_float').notNull().default(0),
  countedCash: integer('counted_cash'),
  expectedCash: integer('expected_cash'),
  variance: integer('variance'),
})

export const orders = sqliteTable(
  'orders',
  {
    id: id(),
    orderNo: integer('order_no').notNull(),
    type: text('type', { enum: ['dine_in', 'takeaway', 'car', 'delivery'] }).notNull(),
    status: text('status', { enum: ['open', 'billed', 'settled', 'void'] }).notNull().default('open'),

    tableId: text('table_id').references(() => tables.id),
    /** Free text so two parties on one table stay distinguishable: "Blue shirt". */
    ticketLabel: text('ticket_label'),

    customerId: text('customer_id').references(() => customers.id),
    /** Snapshotted — a later address edit must not rewrite past deliveries. */
    addressSnapshot: text('address_snapshot'),
    phoneSnapshot: text('phone_snapshot'),
    vehicleNo: text('vehicle_no'),
    bayNo: text('bay_no'),

    /** Who serves it / gets the credit. Prints on KOT and bill. Admin-reassignable. */
    waiterId: text('waiter_id').references(() => employees.id),
    /** Who physically keyed it. Audit only. NEVER editable. */
    createdBy: text('created_by').notNull().references(() => employees.id),

    openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull(),
    billedAt: integer('billed_at', { mode: 'timestamp_ms' }),
    settledAt: integer('settled_at', { mode: 'timestamp_ms' }),

    subtotal: integer('subtotal').notNull().default(0),
    discountType: text('discount_type', { enum: ['none', 'percent', 'amount'] }).notNull().default('none'),
    discountValue: integer('discount_value').notNull().default(0),
    discountAmount: integer('discount_amount').notNull().default(0),
    discountReason: text('discount_reason'),
    discountBy: text('discount_by').references(() => employees.id),
    serviceCharge: integer('service_charge').notNull().default(0),
    taxAmount: integer('tax_amount').notNull().default(0),
    total: integer('total').notNull().default(0),

    /** Allocated on first bill print, inside a transaction. Gapless, never reused. */
    invoiceNo: integer('invoice_no'),
    counterId: text('counter_id').references(() => counters.id),
    reprintCount: integer('reprint_count').notNull().default(0),
    /** Set on every bill print — shown in admin, not used for logic. */
    lastPrintedAt: integer('last_printed_at', { mode: 'timestamp_ms' }),
    /**
     * Lines or discount changed since the last bill print, so the paper in the
     * customer's hand is stale and the next print must say REVISED.
     * An explicit flag, not a timestamp comparison: `created_at` has second
     * resolution and would make the check flaky within the same second.
     */
    dirtySincePrint: integer('dirty_since_print', { mode: 'boolean' }).notNull().default(false),
    shiftId: text('shift_id').references(() => shifts.id),
  },
  (t) => ({
    byStatus: index('orders_status_idx').on(t.status),
    byTable: index('orders_table_idx').on(t.tableId),
    byOpenedAt: index('orders_opened_idx').on(t.openedAt),
    byInvoiceNo: uniqueIndex('orders_invoice_no_idx').on(t.invoiceNo),
    byOrderNo: uniqueIndex('orders_order_no_idx').on(t.orderNo),
  }),
)

export const orderItems = sqliteTable(
  'order_items',
  {
    id: id(),
    orderId: text('order_id').notNull().references(() => orders.id),
    itemId: text('item_id').notNull().references(() => items.id),
    /** Snapshots — menu price changes must never rewrite past invoices. */
    nameSnapshot: text('name_snapshot').notNull(),
    unitPriceSnapshot: integer('unit_price_snapshot').notNull(),
    qty: integer('qty').notNull(),
    /** [{ id, name, priceDelta }] captured at add time. */
    modifiersJson: text('modifiers_json').notNull().default('[]'),
    note: text('note'),
    status: text('status', { enum: ['new', 'sent', 'void'] }).notNull().default('new'),
    /** True when saved without a KOT — kitchen never received it. */
    kotSuppressed: integer('kot_suppressed', { mode: 'boolean' }).notNull().default(false),
    voidReason: text('void_reason'),
    voidedBy: text('voided_by').references(() => employees.id),
    /** Needed to attribute a void to the shift it happened in. */
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    /**
     * Client-generated id for the batch these lines arrived in. A tablet that
     * retries a queued send replays the same ref, and the hub recognises it
     * instead of duplicating the round — which is what makes offline-then-retry
     * safe rather than a source of double orders.
     */
    batchRef: text('batch_ref'),
    /** Whoever sent this batch — may differ from the order's waiter. */
    createdBy: text('created_by').notNull().references(() => employees.id),
    createdAt: createdAt(),
  },
  (t) => ({
    byOrder: index('order_items_order_idx').on(t.orderId),
    byStatus: index('order_items_status_idx').on(t.status),
    byBatch: index('order_items_batch_idx').on(t.batchRef),
  }),
)

export const kotTickets = sqliteTable(
  'kot_tickets',
  {
    id: id(),
    orderId: text('order_id').notNull().references(() => orders.id),
    kitchenId: text('kitchen_id').notNull().references(() => kitchens.id),
    /** Per-order sequence: KOT #1, KOT #2 (ADD-ON), ... */
    seq: integer('seq').notNull(),
    kind: text('kind', { enum: ['new', 'addon', 'void'] }).notNull().default('new'),
    linesJson: text('lines_json').notNull(),
    printedAt: integer('printed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => ({ byOrder: index('kot_order_idx').on(t.orderId) }),
)

export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    orderId: text('order_id').notNull().references(() => orders.id),
    paymentModeId: text('payment_mode_id').notNull().references(() => paymentModes.id),
    amount: integer('amount').notNull(),
    refNo: text('ref_no'),
    counterId: text('counter_id').notNull().references(() => counters.id),
    shiftId: text('shift_id').references(() => shifts.id),
    createdBy: text('created_by').notNull().references(() => employees.id),
    createdAt: createdAt(),
  },
  (t) => ({
    byOrder: index('payments_order_idx').on(t.orderId),
    byShift: index('payments_shift_idx').on(t.shiftId),
  }),
)

export const printJobs = sqliteTable(
  'print_jobs',
  {
    id: id(),
    printerId: text('printer_id').notNull().references(() => printers.id),
    /** 'invoice' is historical: the bill is the tax invoice now. 'drawer' pops the cash drawer, no paper. */
    kind: text('kind', { enum: ['kot', 'invoice', 'bill', 'void', 'report', 'test', 'drawer'] }).notNull(),
    payloadJson: text('payload_json').notNull(),
    status: text('status', { enum: ['pending', 'printing', 'done', 'failed'] }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    refId: text('ref_id'),
    createdAt: createdAt(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    byStatus: index('print_jobs_status_idx').on(t.status),
    byPrinter: index('print_jobs_printer_idx').on(t.printerId),
  }),
)

export const expenses = sqliteTable('expenses', {
  id: id(),
  expenseCategoryId: text('expense_category_id').notNull().references(() => expenseCategories.id),
  amount: integer('amount').notNull(),
  note: text('note'),
  paidBy: text('paid_by').notNull().references(() => employees.id),
  shiftId: text('shift_id').references(() => shifts.id),
  /** Must reduce expected cash, or the Z-report variance is wrong every night. */
  paidFromDrawer: integer('paid_from_drawer', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
})

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: id(),
    employeeId: text('employee_id').references(() => employees.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    detailJson: text('detail_json'),
    createdAt: createdAt(),
  },
  (t) => ({ byCreatedAt: index('audit_created_idx').on(t.createdAt) }),
)
