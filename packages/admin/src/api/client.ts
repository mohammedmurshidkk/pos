import type { Bootstrap, Device, LicenceStatus, Order, PrintJob, Printer, ZReport } from './types'

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
  }) => post<{ settled: boolean; paid: number; changeDue?: number; balanceDue?: number; invoiceNo?: number | null }>(
    `/api/orders/${orderId}/settle`, body,
  ),

  voidLine: (orderId: string, lineId: string, reason: string, employeeId: string) =>
    post<unknown>(`/api/orders/${orderId}/items/${lineId}/void`, { reason, employeeId }),

  voidOrder: (orderId: string, reason: string, employeeId: string) =>
    post<unknown>(`/api/orders/${orderId}/void`, { reason, employeeId }),

  printers: () => request<Printer[]>('/api/printers'),
  testPrint: (id: string) => post<unknown>(`/api/printers/${id}/test`),
  printJobs: () => request<PrintJob[]>('/api/print-jobs'),
  retryJobs: (printerId?: string) => post<{ retried: number }>('/api/print-jobs/retry', { printerId }),

  currentShift: (counterId: string) =>
    request<{ shiftId: string | null; open: boolean }>(`/api/shifts/current?counterId=${counterId}`),
  openShift: (body: { counterId: string; employeeId: string; openingFloat: number }) =>
    post<{ id: string }>('/api/shifts/open', body),
  zReport: (shiftId: string) => request<ZReport>(`/api/shifts/${shiftId}/z-report`),
  closeShift: (shiftId: string, body: { countedCash: number; employeeId: string }) =>
    post<{ report: ZReport; backupPath: string | null }>(`/api/shifts/${shiftId}/close`, body),

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
  bulkTables: (body: { areaId: string; prefix: string; from: number; to: number; seats: number }, employeeId: string) =>
    post<{ added: number; skipped: number }>('/api/masters/tables/bulk', { ...body, employeeId }),
  updateSettings: (body: Record<string, unknown>, employeeId: string) =>
    request<unknown>('/api/settings', { method: 'PATCH', body: JSON.stringify({ ...body, employeeId }) }),

  report: <T>(kind: string, params: Record<string, string> = {}) =>
    request<{ range: { label: string }; data: T }>(
      `/api/reports/${kind}?${new URLSearchParams({ preset: 'today', ...params })}`,
    ),
}
