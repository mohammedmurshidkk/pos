import net from 'node:net'
import { sendUsb, usbStatus } from './printer-usb.js'

export interface PrinterTarget {
  ip: string
  port: number
}

/** A printers row, as much of it as delivery needs. */
export interface PrinterRow {
  connection: 'network' | 'usb'
  ip: string
  port: number
  systemName: string | null
}

/**
 * Deliver one ticket, however this printer is attached. Everything above this
 * — routing, templates, the queue's retries — is the same for both.
 */
export function deliver(p: PrinterRow, payload: Buffer): Promise<void> {
  return p.connection === 'usb'
    ? sendUsb(p.systemName ?? '', payload)
    : sendToPrinter({ ip: p.ip, port: p.port }, payload)
}

/** Green or red for the top bar and Dashboard, plus why when Windows says. */
export async function printerHealth(p: PrinterRow): Promise<{ online: boolean; detail: string | null }> {
  if (p.connection === 'usb') return usbStatus(p.systemName ?? '')
  const online = await pingPrinter({ ip: p.ip, port: p.port })
  return { online, detail: online ? null : `No answer from ${p.ip}:${p.port}` }
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
