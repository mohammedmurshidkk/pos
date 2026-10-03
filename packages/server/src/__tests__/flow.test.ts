import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

// Must be set before db.ts is imported — it opens the file at module load.
process.env.POS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'pos-')), 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { newId, schema } = await import('@pos/shared')
const { addItems, createOrder, getOrder, listOpenOrders, sendToKitchen, setTable, setWaiter, submitOrder } = await import('../services/orders.js')
const { applyDiscount, printBill, settle } = await import('../services/billing.js')
const { openShift } = await import('../services/shifts.js')
const { voidLine, voidOrder, removeUnsentLine } = await import('../services/voids.js')
const { eq } = await import('drizzle-orm')

const s = schema
let ids: Record<string, string> = {}

const itemId = (name: string) => db.select().from(s.items).where(eq(s.items.name, name)).get()!.id
const empId = (name: string) => db.select().from(s.employees).where(eq(s.employees.name, name)).get()!.id
const modeId = (name: string) => db.select().from(s.paymentModes).where(eq(s.paymentModes.name, name)).get()!.id

beforeAll(() => {
  migrateDb()
  seed()
  ids = {
    alfaham: itemId('Periperi Alfaham'),
    noodles: itemId('Chicken Noodles'),
    juice: itemId('Apple Juice'),
    rahul: empId('Rahul'),
    anees: empId('Anees'),
    fatima: empId('Fatima'),
    counter: db.select().from(s.counters).get()!.id,
    cash: modeId('Cash'),
    sbi: modeId('SBI Card'),
  }
  // Payments are refused outside a shift.
  openShift({ counterId: ids.counter!, employeeId: ids.fatima!, openingFloat: 0 })
})

const openOrder = (lines: { itemId: string; qty: number }[] = [{ itemId: ids.alfaham!, qty: 1 }]) => {
  const o = createOrder({ type: 'takeaway', createdBy: ids.rahul! })!
  addItems(o.id, lines, ids.rahul!)
  return o.id
}

describe('invoice numbering', () => {
  it('allocates on first bill print and keeps the number when items are added', () => {
    const id = openOrder()
    const first = printBill(id, ids.rahul!, ids.counter!)
    expect(first.invoiceNo).toBeGreaterThan(0)
    expect(first.reprintCount).toBe(0)

    addItems(id, [{ itemId: ids.juice!, qty: 1 }], ids.rahul!)
    const second = printBill(id, ids.rahul!, ids.counter!)

    expect(second.invoiceNo).toBe(first.invoiceNo) // same invoice, updated total
    expect(second.reprintCount).toBe(1)
    expect(second.revised).toBe(true) // paper in the customer's hand is stale
  })

  it('is gapless and sequential across orders', () => {
    const nos = [openOrder(), openOrder(), openOrder()].map(
      (id) => printBill(id, ids.rahul!, ids.counter!).invoiceNo!,
    )
    expect(nos[1]).toBe(nos[0]! + 1)
    expect(nos[2]).toBe(nos[1]! + 1)
  })

  it('keeps the number when an order is cancelled — never reuses it', () => {
    const id = openOrder()
    const { invoiceNo } = printBill(id, ids.rahul!, ids.counter!)
    voidOrder(id, 'Customer left', ids.fatima!)

    const after = printBill(openOrder(), ids.rahul!, ids.counter!)
    expect(after.invoiceNo).toBe(invoiceNo! + 1) // voided number is spent, not recycled

    const voided = db.select().from(s.orders).where(eq(s.orders.id, id)).get()!
    expect(voided.status).toBe('void')
    expect(voided.invoiceNo).toBe(invoiceNo) // retained as a void record
  })
})

describe('settlement', () => {
  const jobsFor = (orderId: string) =>
    db.select().from(s.printJobs).where(eq(s.printJobs.refId, orderId)).all()
  const payloadOf = (job: { payloadJson: string }) => JSON.parse(job.payloadJson) as {
    reprintCount: number; wasEditedAfterPrint: boolean; taxNumberValue: string; invoiceNo: string | null
    payments?: { name: string; amount: number }[]; openDrawer?: boolean
  }

  it('prints the bill as the tax invoice and does not print again at settlement', () => {
    const id = openOrder()
    printBill(id, ids.rahul!, ids.counter!)
    printBill(id, ids.rahul!, ids.counter!) // a reprint before paying
    const total = getOrder(id)!.total
    const r = settle(id, {
      payments: [{ paymentModeId: ids.cash!, amount: total }],
      employeeId: ids.fatima!, counterId: ids.counter!,
    })
    expect(r.settled).toBe(true)
    expect(r.changeDue).toBe(0)
    expect(r.printed).toBe(false)

    const jobs = jobsFor(id)
    expect(jobs.map((j) => j.kind)).toEqual(['bill', 'bill', 'drawer'])
    const bill = payloadOf(jobs[0]!)
    expect(bill.invoiceNo).toBeTruthy()
    expect(bill.taxNumberValue).toBeTruthy() // TRN is mandatory on a UAE tax invoice
  })

  it('prints the bill at settlement when none was printed, with payments and the drawer', () => {
    const id = openOrder()
    const total = getOrder(id)!.total
    const r = settle(id, {
      payments: [{ paymentModeId: ids.cash!, amount: total }],
      employeeId: ids.fatima!, counterId: ids.counter!,
    })
    expect(r.printed).toBe(true)
    expect(r.invoiceNo).toBeTruthy()

    const jobs = jobsFor(id)
    expect(jobs.map((j) => j.kind)).toEqual(['bill'])
    const p = payloadOf(jobs[0]!)
    expect(p.reprintCount).toBe(0)
    expect(p.payments).toEqual([{ name: 'Cash', amount: total }])
    expect(p.openDrawer).toBe(true)
  })

  it('prints a REVISED bill at settlement when the order changed after printing', () => {
    const id = openOrder()
    printBill(id, ids.rahul!, ids.counter!)
    addItems(id, [{ itemId: ids.juice!, qty: 1 }], ids.rahul!)
    const total = getOrder(id)!.total
    const r = settle(id, {
      payments: [{ paymentModeId: ids.cash!, amount: total }],
      employeeId: ids.fatima!, counterId: ids.counter!,
    })
    expect(r.printed).toBe(true)

    const last = jobsFor(id).at(-1)!
    expect(last.kind).toBe('bill')
    expect(payloadOf(last)).toMatchObject({ wasEditedAfterPrint: true, reprintCount: 1, openDrawer: true })
    expect(getOrder(id)!.dirtySincePrint).toBe(false)
  })

  it('prints nothing and opens no drawer for a card payment against a printed bill', () => {
    const id = openOrder()
    printBill(id, ids.rahul!, ids.counter!)
    settle(id, {
      payments: [{ paymentModeId: ids.sbi!, amount: getOrder(id)!.total, refNo: '9921' }],
      employeeId: ids.fatima!, counterId: ids.counter!,
    })
    expect(jobsFor(id).map((j) => j.kind)).toEqual(['bill'])
  })

  it('reprints after settlement with payments, keeping the settling counter', () => {
    const id = openOrder()
    const total = getOrder(id)!.total
    settle(id, {
      payments: [{ paymentModeId: ids.cash!, amount: total }],
      employeeId: ids.fatima!, counterId: ids.counter!,
    })
    const other = newId()
    db.insert(s.counters).values({
      id: other, name: 'Second Till', printerId: db.select().from(s.printers).get()!.id,
    }).run()

    const r = printBill(id, ids.fatima!, other)
    expect(r.reprintCount).toBe(1)
    const order = getOrder(id)!
    expect(order.status).toBe('settled')
    expect(order.counterId).toBe(ids.counter) // the Z-report's counter, untouched
    expect(payloadOf(jobsFor(id).at(-1)!).payments).toEqual([{ name: 'Cash', amount: total }])
  })

  it('refuses payment when no shift is open on the counter', () => {
    const shiftless = newId()
    db.insert(s.counters).values({
      id: shiftless, name: 'No Shift Till', printerId: db.select().from(s.printers).get()!.id,
    }).run()
    const id = openOrder()
    expect(() => settle(id, {
      payments: [{ paymentModeId: ids.cash!, amount: getOrder(id)!.total }],
      employeeId: ids.fatima!, counterId: shiftless,
    })).toThrow(/no shift is open/i)
    expect(db.select().from(s.payments).where(eq(s.payments.orderId, id)).all()).toEqual([])
  })

  it('handles a split tender across two merchant accounts', () => {
    const id = openOrder([{ itemId: ids.alfaham!, qty: 2 }])
    const total = getOrder(id)!.total

    const partial = settle(id, {
      payments: [{ paymentModeId: ids.cash!, amount: 5000 }],
      employeeId: ids.fatima!, counterId: ids.counter!,
    })
    expect(partial.settled).toBe(false)
    expect(partial.balanceDue).toBe(total - 5000)

    const rest = settle(id, {
      payments: [{ paymentModeId: ids.sbi!, amount: total - 5000, refNo: '4411' }],
      employeeId: ids.fatima!, counterId: ids.counter!,
    })
    expect(rest.settled).toBe(true)

    const rows = db.select().from(s.payments).where(eq(s.payments.orderId, id)).all()
    expect(rows).toHaveLength(2)
  })

  it('rejects a card payment with no reference number', () => {
    const id = openOrder()
    expect(() =>
      settle(id, {
        payments: [{ paymentModeId: ids.sbi!, amount: getOrder(id)!.total }],
        employeeId: ids.fatima!, counterId: ids.counter!,
      }),
    ).toThrow(/approval or reference/i)
  })

  it('returns change when the customer overpays', () => {
    const id = openOrder()
    const total = getOrder(id)!.total
    const r = settle(id, {
      payments: [{ paymentModeId: ids.cash!, amount: total + 1500 }],
      employeeId: ids.fatima!, counterId: ids.counter!,
    })
    expect(r.changeDue).toBe(1500)
  })

  it('locks the order after settlement', () => {
    const id = openOrder()
    settle(id, {
      payments: [{ paymentModeId: ids.cash!, amount: getOrder(id)!.total }],
      employeeId: ids.fatima!, counterId: ids.counter!,
    })
    expect(() => addItems(id, [{ itemId: ids.juice!, qty: 1 }], ids.rahul!)).toThrow(/settled/i)
    expect(() => settle(id, { payments: [], employeeId: ids.fatima!, counterId: ids.counter! })).toThrow(/already settled/i)
  })
})

describe('voids', () => {
  it('sends a cancellation ticket for a line the kitchen already received', () => {
    const id = openOrder()
    sendToKitchen(id, ids.rahul!)
    const line = getOrder(id)!.lines[0]!

    const before = db.select().from(s.printJobs).all().length
    const r = voidLine(id, line.id, 'Customer changed mind', ids.fatima!)

    expect(r.cancelTicketSent).toBe(true)
    const jobs = db.select().from(s.printJobs).all()
    expect(jobs.length).toBe(before + 1)
    expect(jobs.at(-1)!.kind).toBe('void')
    expect(r.totals.total).toBe(0) // voided line no longer counts
  })

  it('sends no cancellation for a line the kitchen never received', () => {
    const id = openOrder()
    sendToKitchen(id, ids.fatima!, true) // saved without KOT
    const line = getOrder(id)!.lines[0]!
    expect(voidLine(id, line.id, 'Mistake', ids.fatima!).cancelTicketSent).toBe(false)
  })

  it('requires a reason', () => {
    const id = openOrder()
    sendToKitchen(id, ids.rahul!)
    const line = getOrder(id)!.lines[0]!
    expect(() => voidLine(id, line.id, '  ', ids.fatima!)).toThrow(/reason/i)
  })

  it('removes an unsent line without troubling the kitchen', () => {
    const id = openOrder()
    const line = getOrder(id)!.lines[0]!
    const before = db.select().from(s.printJobs).all().length
    removeUnsentLine(id, line.id)
    expect(getOrder(id)!.lines).toHaveLength(0)
    expect(db.select().from(s.printJobs).all().length).toBe(before)
  })

  it('refuses to remove a line that was already sent', () => {
    const id = openOrder()
    sendToKitchen(id, ids.rahul!)
    const line = getOrder(id)!.lines[0]!
    expect(() => removeUnsentLine(id, line.id)).toThrow(/void it instead/i)
  })

  it('notifies each kitchen once when a whole order is cancelled', () => {
    const id = openOrder([
      { itemId: ids.alfaham!, qty: 1 },
      { itemId: ids.noodles!, qty: 1 },
      { itemId: ids.juice!, qty: 1 },
    ])
    sendToKitchen(id, ids.rahul!)
    const r = voidOrder(id, 'Walked out', ids.fatima!)
    expect(r.kitchensNotified).toBe(3)
  })
})

describe('discounts', () => {
  it('blocks an employee without permission', () => {
    const id = openOrder()
    expect(() => applyDiscount(id, { type: 'percent', value: 10, employeeId: ids.rahul! }))
      .toThrow(/not permitted/i)
  })

  it('applies for an authorised employee and records it', () => {
    const id = openOrder()
    const r = applyDiscount(id, { type: 'percent', value: 10, reason: 'Staff Meal', employeeId: ids.fatima! })
    expect(r.discountAmount).toBe(850) // 10% of 85.00
    const log = db.select().from(s.auditLog).where(eq(s.auditLog.entityId, id)).all()
    expect(log.some((l) => l.action === 'order.discount')).toBe(true)
  })
})

describe('submit (offline-safe)', () => {
  const payload = (batchRef: string) => ({
    batchRef,
    type: 'takeaway' as const,
    lines: [{ itemId: ids.alfaham!, qty: 1 }],
    employeeId: ids.rahul!,
  })

  it('creates, adds lines and sends in one call', () => {
    const r = submitOrder(payload('batch-1'))
    expect(r.duplicate).toBe(false)
    expect(r.order!.lines).toHaveLength(1)
    expect(r.order!.lines[0]!.status).toBe('sent')
    expect(r.result!.tickets.length).toBeGreaterThan(0)
  })

  it('is idempotent — a replayed batch does not double the order', () => {
    // Exactly the case where the tablet sent successfully but lost the reply.
    const first = submitOrder(payload('batch-2'))
    const ticketsBefore = db.select().from(s.kotTickets).all().length

    const retry = submitOrder(payload('batch-2'))
    expect(retry.duplicate).toBe(true)
    expect(retry.order!.id).toBe(first.order!.id)
    expect(retry.order!.lines).toHaveLength(1)
    expect(db.select().from(s.kotTickets).all().length).toBe(ticketsBefore)
  })

  it('adds an add-on round to an existing order', () => {
    const first = submitOrder(payload('batch-3'))
    const second = submitOrder({
      ...payload('batch-4'),
      orderId: first.order!.id,
      lines: [{ itemId: ids.juice!, qty: 2 }],
    })
    expect(second.order!.id).toBe(first.order!.id)
    expect(second.order!.lines).toHaveLength(2)
    expect(second.result!.kind).toBe('addon')
  })
})

describe('change table', () => {
  it('moves a dine-in order and records who did it', () => {
    const table = db.select().from(s.tables).all()[0]!
    const o = createOrder({ type: 'dine_in', createdBy: ids.rahul! })!
    const moved = setTable(o.id, table.id, ids.fatima!)
    expect(moved!.tableId).toBe(table.id)

    const log = db.select().from(s.auditLog).where(eq(s.auditLog.entityId, o.id)).all()
    expect(log.some((l) => l.action === 'order.change_table')).toBe(true)
  })

  it('refuses for a takeaway order', () => {
    const table = db.select().from(s.tables).all()[0]!
    const o = createOrder({ type: 'takeaway', createdBy: ids.rahul! })!
    expect(() => setTable(o.id, table.id, ids.fatima!)).toThrow(/dine-in/i)
  })
})

describe('open orders list', () => {
  it('includes lines — the tablet shows an item count from them', () => {
    const id = openOrder([{ itemId: ids.alfaham!, qty: 1 }, { itemId: ids.juice!, qty: 2 }])
    const row = listOpenOrders().find((o) => o.id === id)
    expect(row).toBeDefined()
    expect(row!.lines).toHaveLength(2)
    expect(row!.lines[0]!.nameSnapshot).toBeTruthy()
  })

  it('returns an empty array when nothing is open', () => {
    expect(Array.isArray(listOpenOrders())).toBe(true)
  })
})

describe('attribution', () => {
  it('credits the first sender and records later rounds per line', () => {
    const id = openOrder()
    sendToKitchen(id, ids.rahul!)
    addItems(id, [{ itemId: ids.noodles!, qty: 2 }], ids.anees!)
    sendToKitchen(id, ids.anees!)

    const order = getOrder(id)!
    expect(order.waiterId).toBe(ids.rahul) // credit stays with the owner
    expect(order.lines.at(-1)!.createdBy).toBe(ids.anees) // but the trail is complete
  })

  it('lets an admin reassign the waiter without touching createdBy', () => {
    const id = openOrder()
    sendToKitchen(id, ids.rahul!)
    const after = setWaiter(id, ids.anees!, ids.fatima!)!
    expect(after.waiterId).toBe(ids.anees)
    expect(after.createdBy).toBe(ids.rahul)
  })
})
