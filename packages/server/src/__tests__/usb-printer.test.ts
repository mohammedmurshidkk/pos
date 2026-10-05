import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(path.join(tmpdir(), 'pos-usb-'))
process.env.POS_DB = path.join(dir, 'test.db')
// The queue really runs here; the "spooler" is a folder.
process.env.POS_USB_FAKE_DIR = path.join(dir, 'spool')
delete process.env.POS_PRINT_DISABLED

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const M = await import('../services/masters.js')
const { testDrawer } = await import('../services/print-jobs.js')
const { printQueue } = await import('../queue.js')
const { printerHealth } = await import('../printer.js')
const { listUsbPrinters, parseWindowsStatus, usbCommands } = await import('../printer-usb.js')
const { eq } = await import('drizzle-orm')

const s = schema
let admin = ''
const spooled = (name: string) => path.join(dir, 'spool', `${name.replace(/[^\w.-]+/g, '_')}.bin`)

/** Wait for a job to leave the queue, whichever way. */
async function settled(jobId: string) {
  for (let i = 0; i < 100; i++) {
    const job = db.select().from(s.printJobs).where(eq(s.printJobs.id, jobId)).get()!
    if (job.status === 'done' || job.status === 'failed') return job
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('print job never finished')
}

beforeAll(() => {
  migrateDb()
  seed()
  admin = db.select().from(s.employees).where(eq(s.employees.name, 'Fatima')).get()!.id
})

describe('a USB printer in Setup', () => {
  it('needs the Windows printer name, not an IP', () => {
    expect(() => M.createMaster('printers', { name: 'Till', connection: 'usb' }, admin))
      .toThrow(/as Windows knows it/i)
    const p = M.createMaster('printers', { name: 'Till', connection: 'usb', systemName: 'XP-80C', ip: '10.0.0.9' }, admin) as Record<string, unknown>
    expect(p).toMatchObject({ connection: 'usb', systemName: 'XP-80C', ip: '' })
  })

  it('can be renamed without an IP, and needs one to move to the network', () => {
    const p = db.select().from(s.printers).where(eq(s.printers.name, 'Till')).get()!
    expect(M.updateMaster('printers', p.id, { name: 'Till USB' }, admin)).toMatchObject({ systemName: 'XP-80C' })
    expect(() => M.updateMaster('printers', p.id, { connection: 'network' }, admin)).toThrow(/IP address like/i)
    const moved = M.updateMaster('printers', p.id, { connection: 'network', ip: '192.168.1.50' }, admin)
    expect(moved).toMatchObject({ connection: 'network', ip: '192.168.1.50', systemName: null })
    M.updateMaster('printers', p.id, { connection: 'usb', systemName: 'USB Test Printer' }, admin)
  })

  it('leaves every existing printer on the network', () => {
    const seeded = db.select().from(s.printers).all().filter((p) => p.name !== 'Till USB')
    expect(seeded.length).toBeGreaterThan(0)
    expect(seeded.every((p) => p.connection === 'network' && p.ip !== '')).toBe(true)
  })

  it('lists the printers installed on the PC', async () => {
    expect(await listUsbPrinters()).toEqual(['USB Test Printer'])
  })
})

describe('printing to it', () => {
  it('sends the test page through the queue', async () => {
    const p = db.select().from(s.printers).where(eq(s.printers.name, 'Till USB')).get()!
    const id = 'usb-test-page'
    db.insert(s.printJobs).values({
      id, printerId: p.id, kind: 'test',
      payloadJson: JSON.stringify({ printerName: p.name, ip: '', port: 9100, connection: 'usb', systemName: p.systemName, at: 'now' }),
    }).run()
    printQueue.kick(p.id)
    expect((await settled(id)).status).toBe('done')
    const bytes = readFileSync(spooled('USB Test Printer')).toString('latin1')
    expect(bytes).toContain('TEST PRINT')
    expect(bytes).toContain('USB - USB Test Printer')
  })

  it('opens the cash drawer with the same kick bytes as the network', async () => {
    const p = db.select().from(s.printers).where(eq(s.printers.name, 'Till USB')).get()!
    const before = readFileSync(spooled('USB Test Printer')).length
    const { jobId } = testDrawer(p.id, admin)
    expect((await settled(jobId)).status).toBe('done')
    const kick = readFileSync(spooled('USB Test Printer')).subarray(before).toString('latin1')
    expect(kick).toContain('\x1bp\x00\x19\x78')
    // A drawer test is an open drawer with no sale: it must be on record.
    const log = db.select().from(s.auditLog).all().filter((a) => a.action === 'printer.drawer_test')
    expect(log).toHaveLength(1)
  })

  it('refuses a drawer test on a disabled printer', () => {
    const p = M.createMaster('printers', { name: 'Old', connection: 'usb', systemName: 'Old one', enabled: false }, admin) as { id: string }
    expect(() => testDrawer(p.id, admin)).toThrow(/disabled/i)
    expect(existsSync(spooled('Old one'))).toBe(false)
  })

  it('reports a USB printer with no name chosen as offline', async () => {
    expect(await printerHealth({ connection: 'usb', ip: '', port: 9100, systemName: null }))
      .toEqual({ online: false, detail: 'No Windows printer chosen' })
  })
})

describe('Windows', () => {
  it('reads the spooler status, counting a backlog as offline', () => {
    expect(parseWindowsStatus('Normal|False|0')).toEqual({ online: true, detail: null })
    expect(parseWindowsStatus('Printing|False|1').online).toBe(true)
    expect(parseWindowsStatus('Normal|True|0').detail).toMatch(/offline/i)
    expect(parseWindowsStatus('PaperOut|False|0').detail).toMatch(/PaperOut/)
    expect(parseWindowsStatus('Normal|False|4').detail).toMatch(/4 jobs waiting/)
  })

  it('prints RAW and takes the printer name from the environment, never the script', () => {
    const cmd = usbCommands('win32')!
    expect(cmd.send).toContain('pDataType = "RAW"')
    expect(cmd.send).toContain('$env:POS_PRINTER')
    expect(cmd.send).toContain('$env:POS_FILE')
    expect(cmd.status).toContain('$env:POS_PRINTER')
    expect(usbCommands('darwin')).toBeNull()
  })
})
