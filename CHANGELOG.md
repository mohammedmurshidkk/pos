# Changelog

What changed in each release of Zentivo POS, newest first. One version number
covers both the counter app (Windows) and the waiter tablet app (Android).

This file is the **release notes**: the counter's "Update available" window, the
tablet's update screen and the GitHub release are all cut from it, so write
each line for the restaurant owner, in plain words. The detailed developer log
stays in [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

- New work goes under **[Unreleased]**, in `### Added`, `### Changed` or `### Fixed`.
- `pnpm release 1.2.0` turns [Unreleased] into `## [1.2.0] - <today>` and sets the
  app version. See `RELEASE.md`.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions:
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.2] - 2026-10-18

### Added
- **Updates from inside the app.** The counter checks for a new version by itself, shows
  "Update available" with what is new, downloads it in the background and installs it with
  one tap on **Restart and update**. No more sending the installer over WhatsApp.
- **Tablets update from the counter.** After the counter updates, each tablet shows
  "Update available"; tap it, read what is new, and install. The tablet downloads the new
  app from the counter PC over the shop wifi.
- **Settings → Updates** shows the installed version, checks for updates, and lists what
  changed in each version.
- **Close day** after the last shift: one day-close report with every shift of the day,
  sales by payment type, expenses, cash and VAT. Past day closes can be reprinted.
- **Short names for items** ("cb" for Chicken Biriyani). Searching on the tablet, on New
  order at the counter and in Setup finds items by short name; on the counter, Enter adds
  an exact match. Menu import accepts a short name column.
- **Order note** for takeaway, car and delivery orders. It prints in bold on every kitchen
  ticket for the order, and never on the customer's bill.
- **Search and filter** above every list in Setup.
- **Edit and delete expenses** while the shift is still open.
- **Settle without printing** when no bill has been printed yet, next to Settle & print bill.

### Changed
- **KOT numbers keep counting** across all orders instead of starting at 1 for every order.
- The **waiter on the KOT** is the waiter chosen for the order, not the cashier who keyed it.
- The Z-report **lists each expense** paid from the drawer, not only the total.
- Tablet item search looks through the **whole menu**, not just the open category.

## [1.0.0] - 2026-10-08

### Added
- **Counter closed** screen after closing a shift: sales, expected and counted cash,
  over or short, and the backup result.
- The counter app has its **own title bar** on every screen with minimise, full screen and
  close. Closing hides it to the tray so tablets keep working.

### Changed
- **New order on the counter redesigned for 1024×768 POS screens**: a category rail, a bigger
  item grid, quantities on the tiles, search across all categories.
- Screens narrower than 1024 pixels (for example at 125% Windows scaling) are zoomed to fit
  instead of being cut off.

## [0.6.0] - 2026-10-05

### Added
- **USB receipt printers** connected to the counter PC, as well as network printers.
- **Test drawer** button for each printer.

### Changed
- Cash payment needs an amount typed or a quick amount tapped; an empty amount no longer
  settles the bill in cash.
- A shift cannot be closed while any order is still open, on any counter or tablet.

## [0.5.0] - 2026-10-04

### Changed
- Rebuild of 0.4.0, no changes for the shop.

## [0.4.0] - 2026-10-04

### Added
- New name: **Zentivo POS**, with its own icons. Existing data moves across on first start.
- **Floor** screen with every table's status, guests, time and total.
- **Bills** screen: settled and cancelled bills, search and reprint.
- **Expenses** screen and **Pay out** from the shift.
- **Reports** with 8 tabs and a CSV download for each.
- **Customers** saved by phone number; name, phone and delivery address fill in by themselves.
- **Daily backups**, kept for 30 days, and a backup every time a shift closes.
- **Print queue**: see each print job, retry or discard it.
- **New order** and **Add items** on the counter.
- The counter opens **full screen**; Setup, Settings, Devices and Licence ask for the PIN again.
- Notes on cart lines on the tablet.

### Changed
- Navigation moved to a bar across the top; the home screen is Floor.
- Payment type decides cash handling: only Cash counts as cash at closing.

## [0.3.0] - 2026-10-03

### Added
- First Windows installer and Android tablet app.
- First-time setup by the superadmin, licence keys and trials.
- Menu import from a spreadsheet (CSV) and business settings.
