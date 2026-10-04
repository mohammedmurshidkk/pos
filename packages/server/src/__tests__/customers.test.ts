import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(path.join(tmpdir(), 'pos-customers-'))
process.env.POS_DB = path.join(dir, 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const { addItems, createOrder, sendToKitchen, submitOrder } = await import('../services/orders.js')
const { settle } = await import('../services/billing.js')
const { openShift } = await import('../services/shifts.js')
const { findCustomerByPhone, normalizePhone, saveCustomer, searchCustomers } = await import('../services/customers.js')
const { eq } = await import('drizzle-orm')

const s = schema
let ids: Record<string, string> = {}

beforeAll(() => {
  migrateDb()
  seed()
  const emp = (n: string) => db.select().from(s.employees).where(eq(s.employees.name, n)).get()!.id
  ids = {
    alfaham: db.select().from(s.items).where(eq(s.items.name, 'Periperi Alfaham')).get()!.id,
    rahul: emp('Rahul'), fatima: emp('Fatima'),
    counter: db.select().from(s.counters).get()!.id,
    cash: db.select().from(s.paymentModes).where(eq(s.paymentModes.name, 'Cash')).get()!.id,
    table: db.select().from(s.tables).get()!.id,
  }
  openShift({ counterId: ids.counter!, employeeId: ids.fatima!, openingFloat: 0 })
})

const order = (id: string) => db.select().from(s.orders).where(eq(s.orders.id, id)).get()!
const customerCount = () => db.select().from(s.customers).all().length

describe('phone numbers', () => {
  it('treats spacing and dashes as the same number', () => {
    expect(normalizePhone('050 123-4567')).toBe('0501234567')
    expect(normalizePhone('+971 50 123 4567')).toBe('971501234567')
    expect(normalizePhone('00971501234567')).toBe('971501234567')
    expect(normalizePhone(null)).toBe('')
  })
})

describe('customers are unique by phone', () => {
  it('creates one customer and updates the name on a second visit', () => {
    const before = customerCount()
    const a = saveCustomer({ phone: '050 111 2222', name: 'Ahmed' })
    const b = saveCustomer({ phone: '0501112222', name: 'Ahmed Ali' })
    expect(b).toBe(a)
    expect(customerCount()).toBe(before + 1)
    expect(findCustomerByPhone('050-111-2222')?.name).toBe('Ahmed Ali')
  })

  it('never wipes a known name with a blank one', () => {
    saveCustomer({ phone: '0501112222', name: '' })
    expect(findCustomerByPhone('0501112222')?.name).toBe('Ahmed Ali')
  })

  it('skips a number too short to be real, unless asked to refuse it', () => {
    expect(saveCustomer({ phone: '123', name: 'X' })).toBeNull()
    expect(() => saveCustomer({ phone: '123', name: 'X' }, true)).toThrow(/too short/)
  })

  it('finds customers by part of the number or the name', () => {
    expect(searchCustomers('1112').map((c) => c.phone)).toContain('0501112222')
    expect(searchCustomers('ahmed').map((c) => c.phone)).toContain('0501112222')
    expect(searchCustomers('')).toEqual([])
  })
})

describe('delivery lookup', () => {
  it('saves the delivery customer with the address, and finds them next time', () => {
    const o = createOrder({
      type: 'delivery', phoneSnapshot: '055 999 8888', customerName: 'Sara',
      addressSnapshot: 'Villa 12, Al Nahda', createdBy: ids.rahul!,
    })!
    expect(order(o.id).customerId).toBeTruthy()
    expect(order(o.id).phoneSnapshot).toBe('0559998888')

    const found = findCustomerByPhone('0559998888')!
    expect(found.name).toBe('Sara')
    expect(found.addresses).toEqual(['Villa 12, Al Nahda'])
    expect(found.orderCount).toBe(1)
  })

  it('adds a new address once, newest first', () => {
    for (const addr of ['Flat 3, Tower B', 'Flat 3, Tower B']) {
      createOrder({ type: 'delivery', phoneSnapshot: '0559998888', addressSnapshot: addr, createdBy: ids.rahul! })
    }
    expect(findCustomerByPhone('0559998888')!.addresses).toEqual(['Flat 3, Tower B', 'Villa 12, Al Nahda'])
  })

  it('returns nothing for an unknown number', () => {
    expect(findCustomerByPhone('0500000000')).toBeNull()
  })

  it('uses the takeaway name typed as the ticket label', () => {
    const r = submitOrder({
      batchRef: 'cust-takeaway-1', type: 'takeaway', ticketLabel: 'Nabeel', phoneSnapshot: '0523334444',
      lines: [{ itemId: ids.alfaham!, qty: 1 }], employeeId: ids.rahul!,
    })
    expect(r.order!.customerName).toBe('Nabeel')
    expect(findCustomerByPhone('0523334444')?.name).toBe('Nabeel')
  })

  it('does not fail a queued tablet order over a mistyped number', () => {
    const o = createOrder({ type: 'car', vehicleNo: 'A 123', phoneSnapshot: '12', createdBy: ids.rahul! })!
    expect(order(o.id).customerId).toBeNull()
  })
})

describe('name and phone asked at settle', () => {
  it('links a dine-in order to the customer when the cashier asks', () => {
    const o = createOrder({ type: 'dine_in', tableId: ids.table!, createdBy: ids.rahul! })!
    addItems(o.id, [{ itemId: ids.alfaham!, qty: 1 }], ids.rahul!)
    sendToKitchen(o.id, ids.rahul!)
    settle(o.id, {
      payments: [{ paymentModeId: ids.cash!, amount: order(o.id).total }],
      employeeId: ids.fatima!, counterId: ids.counter!,
      customer: { name: 'Ahmed', phone: '050 111 2222' },
    })
    const row = order(o.id)
    expect(row.status).toBe('settled')
    expect(row.customerName).toBe('Ahmed')
    expect(row.phoneSnapshot).toBe('0501112222')
    expect(row.customerId).toBe(findCustomerByPhone('0501112222')!.id)
    // The bill printed at settle carries the name and phone.
    const job = db.select().from(s.printJobs).where(eq(s.printJobs.refId, o.id)).all().find((j) => j.kind === 'bill')!
    expect(JSON.parse(job.payloadJson)).toMatchObject({ customerName: 'Ahmed', customerPhone: '0501112222' })
  })

  it('settles fine with nothing asked, and refuses a too-short number', () => {
    const o = createOrder({ type: 'dine_in', tableId: ids.table!, createdBy: ids.rahul! })!
    addItems(o.id, [{ itemId: ids.alfaham!, qty: 1 }], ids.rahul!)
    sendToKitchen(o.id, ids.rahul!)
    const pay = { payments: [{ paymentModeId: ids.cash!, amount: order(o.id).total }], employeeId: ids.fatima!, counterId: ids.counter! }
    expect(() => settle(o.id, { ...pay, customer: { phone: '12' } })).toThrow(/too short/)
    expect(order(o.id).status).toBe('open')
    settle(o.id, { ...pay, customer: { name: '', phone: '' } })
    expect(order(o.id).customerId).toBeNull()
  })
})
