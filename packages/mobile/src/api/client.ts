import type { Bootstrap, Customer, Order, SendResult, SubmitPayload } from './types'

/** An error the waiter should see, rather than a crash. */
export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message)
  }
}

export class OfflineError extends Error {
  constructor() {
    super("Can't reach the counter")
  }
}

let baseUrl: string | null = null
export const setBaseUrl = (url: string | null) => { baseUrl = url }
export const getBaseUrl = () => baseUrl

/** Issued once at pairing; the hub rejects every order call without it. */
let deviceToken: string | null = null
export const setDeviceToken = (token: string | null) => { deviceToken = token }

/**
 * Called when the hub says this tablet is no longer paired — revoked from the
 * counter, or a database restored without it. The root layout sends the user
 * back to the pairing screen rather than failing every tap with an error.
 */
let onUnpaired: (() => void) | null = null
export const setOnUnpaired = (fn: (() => void) | null) => { onUnpaired = fn }

/**
 * Every call goes through here.
 *
 * A LAN hop should never take seconds, so the timeout is short — a waiter must
 * find out immediately that the counter is unreachable, not stare at a spinner
 * while the table waits.
 */
function buildHeaders(init?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) }
  // Only declare JSON when we actually send a body — a body-less DELETE with
  // this header makes the server try to parse nothing.
  if (init?.body) headers['content-type'] = 'application/json'
  if (deviceToken) headers['x-device-token'] = deviceToken
  return headers
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  if (!baseUrl) throw new OfflineError()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 6000)

  let res: Response
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: buildHeaders(init),
    })
  } catch {
    throw new OfflineError()
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    let message = 'Something went wrong.'
    let code = 'unknown'
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      message = body.message ?? message
      code = body.error ?? code
    } catch { /* non-JSON error body */ }
    if (res.status === 401 && code === 'unpaired') onUnpaired?.()
    throw new ApiError(message, code, res.status)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const post = <T>(path: string, body?: unknown, timeoutMs?: number) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}), timeoutMs })

export const api = {
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  openOrders: () => request<Order[]>('/api/orders/open'),
  order: (id: string) => request<Order>(`/api/orders/${id}`),

  createOrder: (input: {
    type: string; tableId?: string | null; ticketLabel?: string | null
    vehicleNo?: string | null; bayNo?: string | null
    phoneSnapshot?: string | null; addressSnapshot?: string | null
    createdBy: string
  }) => post<Order>('/api/orders', input),

  addItems: (orderId: string, lines: { itemId: string; qty: number; note?: string | null; modifiers?: { id: string; name: string; priceDelta: number }[] }[], employeeId: string) =>
    post<Order>(`/api/orders/${orderId}/items`, { lines, employeeId }),

  removeLine: (orderId: string, lineId: string) =>
    request<unknown>(`/api/orders/${orderId}/items/${lineId}`, { method: 'DELETE' }),

  send: (orderId: string, employeeId: string, suppressKot = false) =>
    post<SendResult>(`/api/orders/${orderId}/send`, { employeeId, suppressKot }),

  /** One idempotent call — create, add lines and send. Safe to retry. */
  submit: (payload: SubmitPayload) =>
    post<{ order: Order | null; duplicate: boolean }>('/api/orders/submit', payload, 8000),

  setTable: (orderId: string, tableId: string | null, employeeId: string) =>
    post<Order>(`/api/orders/${orderId}/table`, { tableId, employeeId }),

  printBill: (orderId: string, employeeId: string, counterId: string) =>
    post<{ invoiceNo: number | null; reprintCount: number; revised: boolean }>(
      `/api/orders/${orderId}/bill`, { employeeId, counterId },
    ),

  /** Is anything answering at this address? Public, so it works before pairing. */
  health: (url: string) =>
    fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false),

  /** Exchange the code shown on the counter PC for this tablet's token. */
  pairDevice: async (url: string, code: string, name: string) => {
    let res: Response
    try {
      res = await fetch(`${url}/api/devices/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, name }),
        signal: AbortSignal.timeout(6000),
      })
    } catch {
      throw new OfflineError()
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    if (!res.ok) throw new ApiError(body.message ?? 'Pairing failed.', body.error ?? 'unknown', res.status)
    return body as unknown as { deviceId: string; name: string; token: string }
  },

  /** Confirms the stored token is still accepted. */
  me: () => request<{ id: string; name: string } | null>('/api/devices/me'),

  /** Delivery: phone first. `customer` is null when the number is new. */
  lookupCustomer: (phone: string) =>
    request<{ customer: Customer | null }>(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`),
}
