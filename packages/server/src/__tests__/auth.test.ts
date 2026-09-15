import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

process.env.POS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'pos-auth-')), 'test.db')
process.env.POS_PRINT_DISABLED = '1'

const { db, migrateDb } = await import('../db.js')
const { seed } = await import('../seed.js')
const { schema } = await import('@pos/shared')
const A = await import('../services/auth.js')
const M = await import('../services/masters.js')
const { eq } = await import('drizzle-orm')

const s = schema
const emp = (n: string) => db.select().from(s.employees).where(eq(s.employees.name, n)).get()!

beforeAll(() => { migrateDb(); seed() })

describe('PIN hashing', () => {
  it('never stores the PIN in the clear', () => {
    const hash = A.hashPin('1234')
    expect(hash).not.toContain('1234')
    expect(hash.startsWith('scrypt$')).toBe(true)
  })

  it('produces a different hash each time, so equal PINs are not obvious', () => {
    expect(A.hashPin('1234')).not.toBe(A.hashPin('1234'))
  })

  it('verifies the right PIN and rejects the wrong one', () => {
    const hash = A.hashPin('4321')
    expect(A.verifyPin('4321', hash)).toBe(true)
    expect(A.verifyPin('4322', hash)).toBe(false)
    expect(A.verifyPin('4321', null)).toBe(false)
    expect(A.verifyPin('4321', 'garbage')).toBe(false)
  })
})

describe('counter sign-in', () => {
  it('signs an admin in with the seeded PIN', () => {
    const out = A.login(emp('Fatima').id, '1234')
    expect(out.name).toBe('Fatima')
    expect(out.role).toBe('admin')
    expect('pinHash' in out).toBe(false)  // never returned to the client
  })

  it('refuses a waiter — the counter settles money, the tablet does not', () => {
    expect(() => A.login(emp('Rahul').id, '1234')).toThrow(/only admins can sign in/i)
  })

  it('rejects a wrong PIN', () => {
    expect(() => A.login(emp('Salim').id, '0000')).toThrow(/wrong pin/i)
  })

  it('locks out after repeated wrong PINs', () => {
    const id = emp('Salim').id
    for (let i = 0; i < 4; i++) {
      expect(() => A.login(id, '0000')).toThrow()
    }
    // The fifth failure trips the lockout, and even the right PIN waits.
    expect(() => A.login(id, '4321')).toThrow(/too many wrong pins/i)
  })

  it('records failures against the employee for the audit trail', () => {
    const log = db.select().from(s.auditLog).all()
    expect(log.filter((l) => l.action === 'auth.failed').length).toBeGreaterThan(0)
    expect(log.some((l) => l.action === 'auth.login')).toBe(true)
  })
})

describe('setting a PIN', () => {
  it('hashes a PIN set through Setup → Employees', () => {
    const rahul = emp('Rahul')
    M.updateMaster('employees', rahul.id, { pin: '9876' }, emp('Fatima').id)
    const after = emp('Rahul')
    expect(after.pinHash).not.toBeNull()
    expect(after.pinHash).not.toContain('9876')
    expect(A.verifyPin('9876', after.pinHash)).toBe(true)
  })

  it('never writes the PIN into the audit log', () => {
    const rows = db.select().from(s.auditLog).all()
      .filter((l) => l.entity === 'employees')
    expect(rows.every((l) => !(l.detailJson ?? '').includes('9876'))).toBe(true)
  })

  it('rejects a PIN that is not 4 to 6 digits', () => {
    const id = emp('Suhail').id
    expect(() => M.updateMaster('employees', id, { pin: '12' }, emp('Fatima').id)).toThrow(/4 to 6 digits/i)
    expect(() => A.setPin(id, 'abcd', emp('Fatima').id)).toThrow(/4 to 6 digits/i)
  })
})
