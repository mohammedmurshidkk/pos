import type {
  BackupStatus, Bootstrap, ClosedOrder, Customer, Device, Expense, ExpenseCategory, LicenceStatus, MenuImportPlan, MenuImportRow,
  Order, PrintJob, Printer, RangeQuery, RangeResult, Settings, SettingsPatch, SubmitOrder, ZReport,
} from './types'

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    // Only declare JSON when we actually send a body — a body-less DELETE with
    // this header makes the server try to parse nothing.
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  })
  if (!res.ok) {
    let message = 'Something went wrong.'
    let code = 'unknown'
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      message = body.message ?? message
      code = body.error ?? code
    } catch { /* non-JSON body */ }
    throw new ApiError(message, code, res.status)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

const rangeParams = (r: RangeQuery, extra: Record<string, string | undefined> = {}) => {
  const p = new URLSearchParams({ preset: r.preset })
  if (r.from) p.set('from', r.from)
  if (r.to) p.set('to', r.to)
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
  return p.toString()
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

/**
 * Superadmin session token. Memory only — it must not survive a reload, and it
 * is never written to storage where a curious cashier could find it.
 */
let superadminToken: string | null = null
export const setSuperadminToken = (token: string | null) => { superadminToken = token }
const sa = (): Record<string, string> =>
  superadminToken ? { 'x-superadmin-token': superadminToken } : {}

export type TrialUnit = 'minutes' | 'hours' | 'days'

export interface InventoryGroup {
  id: string
  label: string
  description: string
  count: number
  /** Why this cannot be cleared yet — shown to the operator verbatim. */
  blockedBy: string | null
}

export interface AdminRow {
  id: string
  name: string
  active: boolean
  hasPin: boolean
  canDiscount: boolean
  maxDiscountPercent: number
  createdAt: string
}

export const superadmin = {
  status: () => request<{ configured: boolean }>('/api/superadmin/status'),
  login: (password: string) =>
    post<{ token: string; expiresAt: string }>('/api/superadmin/login', { password }),
  /** First run only: choose the password. Answers with a session, like login. */
  setup: (password: string) =>
    post<{ token: string; expiresAt: string }>('/api/superadmin/setup', { password }),
  licence: () => request<LicenceStatus>('/api/superadmin/licence', { headers: sa() }),
  grantTrial: (value: number, unit: TrialUnit) =>
    request<LicenceStatus>('/api/superadmin/trial', { method: 'POST', headers: sa(), body: JSON.stringify({ value, unit }) }),
  installLicence: (key: string) =>
    request<LicenceStatus>('/api/superadmin/licence', { method: 'POST', headers: sa(), body: JSON.stringify({ key }) }),
  logout: () => request<{ ok: true }>('/api/superadmin/logout', { method: 'POST', headers: sa() }),
  admins: () => request<AdminRow[]>('/api/superadmin/admins', { headers: sa() }),
  createAdmin: (name: string, pin: string) =>
    request<AdminRow>('/api/superadmin/admins', { method: 'POST', headers: sa(), body: JSON.stringify({ name, pin }) }),
  resetPin: (id: string, pin: string) =>
    request<{ ok: true }>(`/api/superadmin/admins/${id}/pin`, { method: 'POST', headers: sa(), body: JSON.stringify({ pin }) }),
  setActive: (id: string, active: boolean) =>
    request<{ ok: true }>(`/api/superadmin/admins/${id}/active`, { method: 'POST', headers: sa(), body: JSON.stringify({ active }) }),
  inventory: () => request<InventoryGroup[]>('/api/superadmin/inventory', { headers: sa() }),
  clear: (group: string) =>
    request<{ cleared: string; rows: number; backupPath: string | null }>(
      `/api/superadmin/clear/${group}`, { method: 'POST', headers: sa() },
    ),
  setPassword: (password: string) =>
    request<{ ok: true }>('/api/superadmin/password', { method: 'POST', headers: sa(), body: JSON.stringify({ password }) }),
}

export const api = {
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  openOrders: () => request<Order[]>('/api/orders/open'),
  order: (id: string) => request<Order>(`/api/orders/${id}`),
  closedOrders: (range: RangeQuery) =>
    request<{ range: RangeResult; orders: ClosedOrder[] }>(`/api/orders/closed?${rangeParams(range)}`),

  /** Create (or add a round to) an order and send it to the kitchen, in one idempotent call. */
  submitOrder: (body: SubmitOrder) =>
    post<{ order: Order | null; duplicate: boolean }>('/api/orders/submit', body),

  addItems: (orderId: string, lines: { itemId: string; qty: number; note?: string | null }[], employeeId: string) =>
    post<Order>(`/api/orders/${orderId}/items`, { lines, employeeId }),

  send: (orderId: string, employeeId: string, suppressKot = false) =>
    post<unknown>(`/api/orders/${orderId}/send`, { employeeId, suppressKot }),

  setWaiter: (orderId: string, waiterId: string, employeeId: string) =>
    post<Order>(`/api/orders/${orderId}/waiter`, { waiterId, employeeId }),

  discount: (orderId: string, body: { type: string; value: number; reason?: string | null; employeeId: string }) =>
    post<unknown>(`/api/orders/${orderId}/discount`, body),

  printBill: (orderId: string, employeeId: string, counterId: string) =>
    post<{ invoiceNo: number | null; reprintCount: number; revised: boolean }>(
      `/api/orders/${orderId}/bill`, { employeeId, counterId },
    ),

  settle: (orderId: string, body: {
    payments: { paymentModeId: string; amount: number; refNo?: string | null }[]
    employeeId: string; counterId: string
    customer?: { name?: string | null; phone?: string | null } | null
  }) => post<{ settled: boolean; paid: number; changeDue?: number; balanceDue?: number; invoiceNo?: number | null; printed?: boolean }>(
    `/api/orders/${orderId}/settle`, body,
  ),

  /** `customer` is null when this number has never ordered. */
  lookupCustomer: (phone: string) =>
    request<{ customer: Customer | null }>(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`),

  voidLine: (orderId: string, lineId: string, reason: string, employeeId: string) =>
    post<unknown>(`/api/orders/${orderId}/items/${lineId}/void`, { reason, employeeId }),

  voidOrder: (orderId: string, reason: string, employeeId: string) =>
    post<unknown>(`/api/orders/${orderId}/void`, { reason, employeeId }),

  printers: () => request<Printer[]>('/api/printers'),
  testPrint: (id: string) => post<unknown>(`/api/printers/${id}/test`),
  /** Printers installed in Windows on the counter PC, for a USB printer. */
  systemPrinters: () => request<{ printers: string[]; error: string | null }>('/api/printers/system'),
  testDrawer: (id: string, employeeId: string) => post<{ queued: boolean }>(`/api/printers/${id}/drawer`, { employeeId }),
  retryJobs: (printerId?: string) => post<{ retried: number }>('/api/print-jobs/retry', { printerId }),
  printJobs: (status: 'problems' | 'all' = 'problems') =>
    request<{ jobs: PrintJob[]; counts: Record<string, { pending: number; failed: number }> }>(`/api/print-jobs?status=${status}`),
  retryJob: (id: string, employeeId: string) => post<{ id: string }>(`/api/print-jobs/${id}/retry`, { employeeId }),
  discardJob: (id: string, employeeId: string) => post<{ id: string }>(`/api/print-jobs/${id}/discard`, { employeeId }),

  backups: () => request<BackupStatus>('/api/backups'),
  backupNow: (employeeId: string) =>
    post<{ path: string; bytes: number; pruned: string[]; status: BackupStatus }>('/api/backups', { employeeId }),
  setBackupFolder: (dir: string | null, employeeId: string) =>
    request<BackupStatus>('/api/backups/folder', { method: 'PUT', body: JSON.stringify({ dir, employeeId }) }),

  currentShift: (counterId: string) =>
    request<{ shiftId: string | null; open: boolean; canOpen: boolean }>(`/api/shifts/current?counterId=${counterId}`),
  openShift: (body: { counterId: string; employeeId: string; openingFloat: number }) =>
    post<{ id: string }>('/api/shifts/open', body),
  zReport: (shiftId: string) => request<ZReport>(`/api/shifts/${shiftId}/z-report`),
  closeShift: (shiftId: string, body: { countedCash: number; employeeId: string }) =>
    post<{ report: ZReport; backupPath: string | null; backupError?: string | null }>(`/api/shifts/${shiftId}/close`, body),

  expenses: (range: RangeQuery, categoryId?: string) =>
    request<{ range: RangeResult; expenses: Expense[] }>(`/api/expenses?${rangeParams(range, { categoryId })}`),
  expenseCategories: () => request<ExpenseCategory[]>('/api/masters/expenseCategories'),
  createExpense: (body: {
    expenseCategoryId: string; amount: number; note: string | null
    paidBy: string; counterId: string | null; paidFromDrawer: boolean
  }) => post<{ id: string }>('/api/expenses', body),

  licence: () => request<LicenceStatus>('/api/licence'),
  installLicence: (key: string, employeeId: string) =>
    post<LicenceStatus>('/api/licence', { key, employeeId }),

  devices: () => request<{ devices: Device[]; addresses: string[] }>('/api/devices'),
  pairingCode: (employeeId: string) =>
    post<{ code: string; expiresAt: string }>('/api/devices/code', { employeeId }),
  cancelPairingCode: () => request<{ cancelled: boolean }>('/api/devices/code', { method: 'DELETE' }),
  revokeDevice: (id: string, employeeId: string) =>
    request<{ revoked: boolean }>(`/api/devices/${id}?employeeId=${employeeId}`, { method: 'DELETE' }),

  login: (employeeId: string, pin: string) =>
    post<{ id: string; name: string; role: 'admin' | 'waiter'; canDiscount: boolean; canSaveWithoutKot: boolean }>(
      '/api/auth/login', { employeeId, pin },
    ),
  /** The signed-in admin's PIN again, before an admin screen or leaving kiosk. */
  confirmPin: (employeeId: string, pin: string, area: string) =>
    post<{ ok: true }>('/api/auth/confirm', { employeeId, pin, area }),
  changePin: (employeeId: string, currentPin: string, newPin: string) =>
    post<{ ok: true }>('/api/auth/change-pin', { employeeId, currentPin, newPin }),

  masters: <T = Record<string, unknown>>(entity: string) => request<T[]>(`/api/masters/${entity}`),
  createMaster: <T>(entity: string, body: Record<string, unknown>, employeeId: string) =>
    post<T>(`/api/masters/${entity}`, { ...body, employeeId }),
  updateMaster: <T>(entity: string, id: string, body: Record<string, unknown>, employeeId: string) =>
    request<T>(`/api/masters/${entity}/${id}`, {
      method: 'PATCH', body: JSON.stringify({ ...body, employeeId }),
    }),
  deactivateMaster: (entity: string, id: string, employeeId: string) =>
    request<{ deactivated: boolean }>(
      `/api/masters/${entity}/${id}?employeeId=${employeeId}`, { method: 'DELETE' },
    ),
  itemModifierGroups: (itemId: string) =>
    request<{ groupIds: string[] }>(`/api/masters/items/${itemId}/modifier-groups`),
  setItemModifierGroups: (itemId: string, groupIds: string[], employeeId: string) =>
    request<{ groupIds: string[] }>(`/api/masters/items/${itemId}/modifier-groups`, {
      method: 'PUT', body: JSON.stringify({ groupIds, employeeId }),
    }),
  bulkTables: (body: { areaId: string; prefix: string; from: number; to: number; seats: number }, employeeId: string) =>
    post<{ added: number; skipped: number }>('/api/masters/tables/bulk', { ...body, employeeId }),
  importMenu: (rows: MenuImportRow[], dryRun: boolean, employeeId: string) =>
    post<MenuImportPlan>('/api/masters/menu/import', { rows, dryRun, employeeId }),
  updateSettings: (body: SettingsPatch, employeeId: string) =>
    request<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify({ ...body, employeeId }) }),

  /** A report over any range; the same URL with format=csv is the download. */
  reportRange: <T>(kind: string, range: RangeQuery) =>
    request<{ range: { label: string; from: string; to: string }; data: T }>(`/api/reports/${kind}?${rangeParams(range)}`),
  reportCsvUrl: (kind: string, range: RangeQuery) => `/api/reports/${kind}?${rangeParams(range, { format: 'csv' })}`,

  report: <T>(kind: string, params: Record<string, string> = {}) =>
    request<{ range: { label: string }; data: T }>(
      `/api/reports/${kind}?${new URLSearchParams({ preset: 'today', ...params })}`,
    ),
}
