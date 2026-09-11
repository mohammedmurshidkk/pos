import { newId, schema } from '@pos/shared'
import { db, raw } from './db.js'

const s = schema

/**
 * Al Manzil Restaurant — the demo dataset used throughout the docs and Stitch
 * designs. Printers point at 127.0.0.1 so `pnpm fake-printers` receives them.
 */
export function seed() {
  const existing = raw.prepare('select count(*) as n from settings').get() as { n: number }
  if (existing.n > 0) {
    console.log('already seeded — delete pos.db to reseed')
    return
  }

  const pArabic = newId(), pChinese = newId(), pJuice = newId(), pCounter = newId()
  db.insert(s.printers).values([
    { id: pArabic, name: 'Arabic Kitchen', ip: '127.0.0.1', port: 9100, width: 80 },
    { id: pChinese, name: 'Chinese Kitchen', ip: '127.0.0.1', port: 9101, width: 80 },
    { id: pJuice, name: 'Juice Corner', ip: '127.0.0.1', port: 9102, width: 58 },
    { id: pCounter, name: 'Counter 1 Printer', ip: '127.0.0.1', port: 9130, width: 80 },
  ]).run()

  const kArabic = newId(), kChinese = newId(), kJuice = newId()
  db.insert(s.kitchens).values([
    { id: kArabic, name: 'Arabic Kitchen', printerId: pArabic },
    { id: kChinese, name: 'Chinese Kitchen', printerId: pChinese },
    { id: kJuice, name: 'Juice Corner', printerId: pJuice },
  ]).run()

  const counter1 = newId()
  db.insert(s.counters).values([{ id: counter1, name: 'Counter 1', printerId: pCounter }]).run()

  const cAlfaham = newId(), cNoodles = newId(), cShakes = newId(), cDesserts = newId()
  db.insert(s.categories).values([
    { id: cAlfaham, name: 'Alfaham', kitchenId: kArabic, sort: 1 },
    { id: cNoodles, name: 'Noodles', kitchenId: kChinese, sort: 2 },
    { id: cShakes, name: 'Shakes & Juices', kitchenId: kJuice, sort: 3 },
    // Deliberately unassigned — exercises the default-kitchen fallback.
    { id: cDesserts, name: 'Desserts', kitchenId: null, sort: 4 },
  ]).run()

  const item = (categoryId: string, name: string, price: number, sort: number) =>
    ({ id: newId(), categoryId, name, price, sort })

  db.insert(s.items).values([
    item(cAlfaham, 'Periperi Alfaham', 8500, 1),
    item(cAlfaham, 'Kanthari Alfaham', 9000, 2),
    item(cAlfaham, 'Alfaham Full', 16000, 3),
    item(cAlfaham, 'Alfaham Quarter', 4500, 4),
    item(cAlfaham, 'Garlic Alfaham', 8800, 5),
    item(cNoodles, 'Chicken Noodles', 3800, 1),
    item(cNoodles, 'Veg Noodles', 3200, 2),
    item(cNoodles, 'Schezwan Noodles', 4000, 3),
    item(cShakes, 'Apple Juice', 2200, 1),
    item(cShakes, 'Mint Lemonade', 1800, 2),
    item(cShakes, 'Mango Shake', 2500, 3),
    item(cDesserts, 'Umm Ali', 2800, 1),
  ]).run()

  const aGround = newId(), aFamily = newId(), aTerrace = newId()
  db.insert(s.areas).values([
    { id: aGround, name: 'Ground Floor', sort: 1 },
    { id: aFamily, name: 'Family Section', sort: 2 },
    { id: aTerrace, name: 'Terrace', sort: 3 },
  ]).run()

  const tables = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: newId(), areaId: aGround, name: `A${i + 1}`, seats: 4, sort: i + 1 })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: newId(), areaId: aFamily, name: `F${i + 1}`, seats: 6, sort: i + 1 })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: newId(), areaId: aTerrace, name: `T${i + 1}`, seats: 4, sort: i + 1 })),
  ]
  db.insert(s.tables).values(tables).run()

  const eRahul = newId(), eAnees = newId(), eSuhail = newId(), eFatima = newId()
  db.insert(s.employees).values([
    { id: eRahul, name: 'Rahul', role: 'waiter' },
    { id: eAnees, name: 'Anees', role: 'waiter' },
    { id: eSuhail, name: 'Suhail', role: 'waiter' },
    {
      id: eFatima, name: 'Fatima', role: 'admin', pinHash: null,
      canDiscount: true, maxDiscountPercent: 100, canSaveWithoutKot: true,
    },
  ]).run()

  db.insert(s.paymentModes).values([
    { id: newId(), name: 'Cash', type: 'cash', opensCashDrawer: true, countsInCashClosing: true, sort: 1 },
    { id: newId(), name: 'SBI Card', type: 'card', merchantName: 'SBI', terminalId: 'SBI-0042', requiresRef: true, sort: 2 },
    { id: newId(), name: 'Canara Card', type: 'card', merchantName: 'Canara', terminalId: 'CNR-0077', requiresRef: true, sort: 3 },
  ]).run()

  db.insert(s.expenseCategories).values([
    { id: newId(), name: 'Vegetables' },
    { id: newId(), name: 'Gas' },
    { id: newId(), name: 'Staff Meal' },
    { id: newId(), name: 'Maintenance' },
  ]).run()

  db.insert(s.settings).values({
    id: 'singleton',
    businessName: 'Al Manzil Restaurant',
    addressLine: 'Al Barsha 1, Dubai, UAE',
    phone: '+971 4 399 1234',
    receiptFooter: 'Thank you - please come again',
    countryCode: 'AE',
    currencyCode: 'AED',
    currencyDisplay: 'AED',
    currencyDecimals: 2,
    taxName: 'VAT',
    taxRateBp: 500,
    taxNumberLabel: 'TRN',
    taxNumberValue: '100123456700003',
    priceIncludesTax: true,
    serviceChargeBp: 0,
    invoicePrefix: 'INV-',
    invoiceNextNo: 1042,
    orderNextNo: 1,
    defaultKitchenId: kArabic,
  }).run()

  db.insert(s.devices).values({
    id: newId(), name: 'Counter PC', type: 'counter_pc',
    pairToken: 'local', defaultCounterId: counter1,
  }).run()

  console.log('seeded Al Manzil: 4 printers, 3 kitchens, 4 categories, 12 items, 22 tables, 4 employees')
}

// Only auto-run when invoked directly (`pnpm seed`), so tests can import it.
if (process.argv[1]?.endsWith('seed.ts')) seed()
