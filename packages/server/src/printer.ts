import net from 'node:net'

export interface PrinterTarget {
  ip: string
  port: number
}

/**
 * Send bytes to an ESC/POS printer over TCP.
 *
 * The connect timeout is the important part: a dead printer IP will otherwise
 * hang the socket forever and silently stall that printer's whole queue. This
 * bites everyone exactly once.
 */
export function sendToPrinter(
  target: PrinterTarget,
  payload: Buffer,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket()
    let done = false

    const finish = (err?: Error) => {
      if (done) return
      done = true
      sock.destroy()
      err ? reject(err) : resolve()
    }

    sock.setTimeout(timeoutMs)
    sock.once('timeout', () => finish(new Error(`timeout after ${timeoutMs}ms`)))
    sock.once('error', (e) => finish(e))
    sock.connect(target.port, target.ip, () => {
      sock.write(payload, (err) => {
        if (err) return finish(err)
        // Give the printer a moment to drain before we close the socket.
        sock.end(() => finish())
      })
    })
  })
}

/** Health check for the admin printer strip — green/red dots. */
export async function pingPrinter(target: PrinterTarget, timeoutMs = 2000): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const sock = new net.Socket()
      sock.setTimeout(timeoutMs)
      sock.once('timeout', () => { sock.destroy(); reject(new Error('timeout')) })
      sock.once('error', (e) => { sock.destroy(); reject(e) })
      sock.connect(target.port, target.ip, () => { sock.destroy(); resolve() })
    })
    return true
  } catch {
    return false
  }
}
