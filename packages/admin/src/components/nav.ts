/**
 * Every screen the top bar can reach.
 *
 * Floor, Billing and New order are the quick tabs — used every minute of
 * service. The rest live behind **More**: daily tasks first, then reports, then
 * the admin screens that are opened a few times a month and ask for the PIN
 * again (see AdminGate).
 */
export interface Screen {
  to: string
  label: string
  hint: string
}

export const QUICK: Screen[] = [
  { to: '/floor', label: 'Floor', hint: 'Tables and open orders' },
  { to: '/billing', label: 'Billing', hint: 'Bills, discounts, settle' },
]

export const MORE: { group: string; adminOnly?: boolean; screens: Screen[] }[] = [
  {
    group: 'Daily',
    screens: [
      { to: '/bills', label: 'Bills', hint: 'Settled and cancelled, reprint' },
      { to: '/shift', label: 'Shift', hint: 'Pay out, close the shift' },
      { to: '/expenses', label: 'Expenses', hint: 'Money out of the drawer' },
    ],
  },
  {
    group: 'Insights',
    screens: [
      { to: '/dashboard', label: 'Dashboard', hint: 'Today at a glance' },
      { to: '/reports', label: 'Reports', hint: 'Sales, items, staff, CSV' },
    ],
  },
  {
    group: 'Admin',
    adminOnly: true,
    screens: [
      { to: '/masters', label: 'Setup', hint: 'Menu, tables, printers, staff' },
      { to: '/settings', label: 'Settings', hint: 'Business, tax, backup' },
      { to: '/devices', label: 'Devices', hint: 'Pair tablets' },
      { to: '/licence', label: 'Licence', hint: 'Trial and licence key' },
    ],
  },
]

/** Screens behind the PIN re-check. */
export const ADMIN_PATHS = MORE.filter((g) => g.adminOnly).flatMap((g) => g.screens.map((s) => s.to))

export const isAdminPath = (pathname: string) =>
  ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

/** The More screen being shown, so the More button can name it. */
export const moreScreenFor = (pathname: string): Screen | undefined =>
  MORE.flatMap((g) => g.screens).find((s) => pathname === s.to || pathname.startsWith(`${s.to}/`))
