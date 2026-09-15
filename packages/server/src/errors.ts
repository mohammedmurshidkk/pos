/** Errors the client is expected to handle and show, not crash on. */
export class AppError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}

export const notFound = (what: string) => new AppError(`${what} not found`, 404, 'not_found')
export const forbidden = (msg: string) => new AppError(msg, 403, 'forbidden')
export const conflict = (msg: string) => new AppError(msg, 409, 'conflict')
/**
 * 402: the licence does not cover this. Distinct from 403 so the tablet's
 * offline queue can tell "expired" apart from "this waiter lacks permission".
 */
export const licenceRequired = (msg: string) => new AppError(msg, 402, 'licence_expired')
/** 401: the caller is not a paired device. The tablet responds by re-pairing. */
export const unpaired = (msg: string) => new AppError(msg, 401, 'unpaired')
