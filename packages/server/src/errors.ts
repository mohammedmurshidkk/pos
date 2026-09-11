/** Errors the client is expected to handle and show, not crash on. */
export class AppError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}

export const notFound = (what: string) => new AppError(`${what} not found`, 404, 'not_found')
export const forbidden = (msg: string) => new AppError(msg, 403, 'forbidden')
export const conflict = (msg: string) => new AppError(msg, 409, 'conflict')
