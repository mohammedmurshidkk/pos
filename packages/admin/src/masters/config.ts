export type Row = Record<string, unknown> & { id: string }

export type Field =
  | { key: string; label: string; kind: 'text'; placeholder?: string; width?: number }
  | { key: string; label: string; kind: 'number'; min?: number; max?: number; width?: number }
  | { key: string; label: string; kind: 'money'; width?: number }
  | { key: string; label: string; kind: 'bool'; width?: number }
  | {
      key: string; label: string; kind: 'select'; width?: number
      /** Another master to draw options from, or a fixed list. */
      from?: string
      choices?: { value: string; label: string }[]
      nullable?: boolean
    }

export interface MasterSpec {
  entity: string
  title: string
  /** Shown under the title — why this master exists, in the client's terms. */
  hint?: string
  fields: Field[]
  /** Entities whose rows are needed to render selects. */
  needs?: string[]
  defaults?: Record<string, unknown>
}

/**
 * The chain the client thinks in:
 *   printer → kitchen → category → item, and printer → counter.
 * Ordered so setting up a new shop reads top to bottom.
 */
export const MASTERS: MasterSpec[] = [
  {
    entity: 'printers',
    title: 'Printers',
    hint: 'Every kitchen and counter prints through one of these. Use a reserved IP so it never moves.',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 200 },
      { key: 'ip', label: 'IP address', kind: 'text', placeholder: '192.168.1.15', width: 160 },
      { key: 'port', label: 'Port', kind: 'number', min: 1, max: 65535, width: 90 },
      { key: 'width', label: 'Paper', kind: 'select', width: 110, choices: [
        { value: '80', label: '80mm' }, { value: '58', label: '58mm' },
      ] },
      { key: 'enabled', label: 'Enabled', kind: 'bool', width: 90 },
    ],
    defaults: { port: 9100, width: 80, enabled: true },
  },
  {
    entity: 'kitchens',
    title: 'Kitchens',
    hint: 'A prep point with a printer. A single-printer shop needs just one.',
    needs: ['printers'],
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 220 },
      { key: 'printerId', label: 'Printer', kind: 'select', from: 'printers', width: 220 },
      { key: 'active', label: 'Active', kind: 'bool', width: 90 },
    ],
    defaults: { active: true },
  },
  {
    entity: 'counters',
    title: 'Counters',
    hint: 'Where invoices print and shifts are counted.',
    needs: ['printers'],
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 220 },
      { key: 'printerId', label: 'Printer', kind: 'select', from: 'printers', width: 220 },
      { key: 'active', label: 'Active', kind: 'bool', width: 90 },
    ],
    defaults: { active: true },
  },
  {
    entity: 'categories',
    title: 'Categories',
    hint: 'The kitchen chosen here decides which printer the KOT goes to. Leave unset to use the default kitchen.',
    needs: ['kitchens'],
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 220 },
      { key: 'kitchenId', label: 'Kitchen', kind: 'select', from: 'kitchens', nullable: true, width: 220 },
      { key: 'sort', label: 'Order', kind: 'number', min: 0, width: 90 },
      { key: 'active', label: 'Active', kind: 'bool', width: 90 },
    ],
    defaults: { sort: 0, active: true },
  },
  {
    entity: 'items',
    title: 'Items',
    hint: 'Price is what the customer pays when prices include tax.',
    needs: ['categories'],
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 220 },
      { key: 'categoryId', label: 'Category', kind: 'select', from: 'categories', width: 180 },
      { key: 'price', label: 'Price', kind: 'money', width: 120 },
      { key: 'isAvailable', label: 'Available', kind: 'bool', width: 100 },
      { key: 'sort', label: 'Order', kind: 'number', min: 0, width: 80 },
      { key: 'active', label: 'Active', kind: 'bool', width: 80 },
    ],
    defaults: { price: 0, isAvailable: true, sort: 0, active: true },
  },
  {
    entity: 'modifierGroups',
    title: 'Modifier groups',
    hint: 'Spice level, add-ons. Minimum 1 makes the choice mandatory.',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 220 },
      { key: 'minSelect', label: 'Min', kind: 'number', min: 0, max: 20, width: 80 },
      { key: 'maxSelect', label: 'Max', kind: 'number', min: 1, max: 20, width: 80 },
      { key: 'sort', label: 'Order', kind: 'number', min: 0, width: 80 },
      { key: 'active', label: 'Active', kind: 'bool', width: 90 },
    ],
    defaults: { minSelect: 0, maxSelect: 1, sort: 0, active: true },
  },
  {
    entity: 'modifiers',
    title: 'Modifiers',
    needs: ['modifierGroups'],
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 200 },
      { key: 'groupId', label: 'Group', kind: 'select', from: 'modifierGroups', width: 200 },
      { key: 'priceDelta', label: 'Price change', kind: 'money', width: 130 },
      { key: 'sort', label: 'Order', kind: 'number', min: 0, width: 80 },
      { key: 'active', label: 'Active', kind: 'bool', width: 90 },
    ],
    defaults: { priceDelta: 0, sort: 0, active: true },
  },
  {
    entity: 'areas',
    title: 'Areas',
    hint: 'Ground floor, family section, terrace.',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 260 },
      { key: 'sort', label: 'Order', kind: 'number', min: 0, width: 90 },
      { key: 'active', label: 'Active', kind: 'bool', width: 90 },
    ],
    defaults: { sort: 0, active: true },
  },
  {
    entity: 'tables',
    title: 'Tables',
    needs: ['areas'],
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 160 },
      { key: 'areaId', label: 'Area', kind: 'select', from: 'areas', width: 200 },
      { key: 'seats', label: 'Seats', kind: 'number', min: 1, max: 40, width: 90 },
      { key: 'sort', label: 'Order', kind: 'number', min: 0, width: 80 },
      { key: 'active', label: 'Active', kind: 'bool', width: 90 },
    ],
    defaults: { seats: 4, sort: 0, active: true },
  },
  {
    entity: 'employees',
    title: 'Employees',
    hint: 'Waiters appear in the tablet picker. Only admins can discount or save without a KOT.',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 200 },
      { key: 'role', label: 'Role', kind: 'select', width: 140, choices: [
        { value: 'waiter', label: 'Waiter' }, { value: 'admin', label: 'Admin' },
      ] },
      { key: 'canDiscount', label: 'Can discount', kind: 'bool', width: 120 },
      { key: 'maxDiscountPercent', label: 'Max %', kind: 'number', min: 0, max: 100, width: 90 },
      { key: 'canSaveWithoutKot', label: 'No-KOT save', kind: 'bool', width: 120 },
      { key: 'active', label: 'Active', kind: 'bool', width: 80 },
    ],
    defaults: { role: 'waiter', canDiscount: false, maxDiscountPercent: 0, canSaveWithoutKot: false, active: true },
  },
  {
    entity: 'paymentModes',
    title: 'Payment modes',
    hint: 'One row per tender. A second card machine is a second row, and the Z-report splits them.',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 160 },
      { key: 'type', label: 'Type', kind: 'select', width: 120, choices: [
        { value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' },
        { value: 'wallet', label: 'Wallet' }, { value: 'credit', label: 'Credit' },
        { value: 'online', label: 'Online' },
      ] },
      { key: 'merchantName', label: 'Merchant', kind: 'text', width: 130 },
      { key: 'terminalId', label: 'Terminal ID', kind: 'text', width: 130 },
      { key: 'requiresRef', label: 'Needs ref', kind: 'bool', width: 100 },
      { key: 'opensCashDrawer', label: 'Opens drawer', kind: 'bool', width: 120 },
      { key: 'countsInCashClosing', label: 'Counts as cash', kind: 'bool', width: 130 },
      { key: 'active', label: 'Active', kind: 'bool', width: 80 },
    ],
    defaults: {
      type: 'card', requiresRef: false, opensCashDrawer: false,
      countsInCashClosing: false, sort: 0, active: true,
    },
  },
  {
    entity: 'expenseCategories',
    title: 'Expense categories',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', width: 300 },
      { key: 'active', label: 'Active', kind: 'bool', width: 90 },
    ],
    defaults: { active: true },
  },
]

export const specFor = (entity: string) => MASTERS.find((m) => m.entity === entity) ?? MASTERS[0]!
