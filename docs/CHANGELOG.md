# Change log

Newest first. The docs keep the old text with a dated **Update** block under it
(see "Keeping the docs" in `CLAUDE.md`); this file is the index of those changes.

## 2026-10-04

| Area | Change | Where |
|---|---|---|
| Expenses | New Expenses screen (list, filters, add) and **Shift → Pay out**. `GET /api/expenses` now honours the date range and `categoryId` | `admin/src/screens/Expenses.tsx`, `Shift.tsx`, `server/src/services/expenses.ts` |
| Bills | New **Bills** screen: settled and cancelled orders, search, reprint. New `GET /api/orders/closed` | `admin/src/screens/Bills.tsx`, `server/src/services/orders.ts` |
| Counter ordering | **+ New order** and **Add items** from Billing, same submit path as the tablet | `admin/src/screens/OrderEntry.tsx`, `Billing.tsx` |
| Billing | Line amounts include modifier prices (totals were already right) | `admin/src/screens/Billing.tsx` |
| Modifiers | Item form "Asks for (modifier groups)" + `GET/PUT /api/masters/items/:id/modifier-groups`; then Modifier groups, Modifiers and "Asks for" **commented out** in Setup (hidden, not removed) | `admin/src/masters/config.ts`, `Masters.tsx`, `server/src/services/masters.ts` |
| Printers | Separate Printers screen removed; **Test print** and **Retry failed prints** moved to Setup → Printers | `Masters.tsx`, `main.tsx`, `Shell.tsx` |
| Settle | Amount on screen counts without "Add payment"; button is now **+ Split payment** | `admin/src/screens/Settle.tsx` |
| Bill print | Kitchen note no longer printed on the bill (still on the KOT) | `server/src/templates.ts` |
| Tablet | **+ Note / Edit note** on cart lines after adding | `mobile/src/store/cart.ts`, `CartPanel.tsx`, `app/menu.tsx` |
| Tests | Server tests 227 → 235 (`history.test.ts`, modifier-group links, bill note) | `server/src/__tests__/` |
| Floor view | New **Floor** screen: tables by area with status, party count, time and total; open takeaway/car/delivery list | `admin/src/screens/Floor.tsx`, `OrderEntry.tsx` (opens with the tapped table) |
| Customers | Saved and looked up by phone (unique, digits only) from any order with a phone; `GET /api/customers/lookup`, `GET /api/customers`; new `orders.customer_name` (migration `0009`) | `server/src/services/customers.ts`, `orders.ts`, `drizzle/0009_confused_maestro.sql` |
| Settle | Optional **Phone** and **Name** asked at settle, saved to the customer and printed on the bill | `admin/src/screens/Settle.tsx`, `components/CustomerFields.tsx`, `server/src/services/billing.ts`, `templates.ts` |
| Counter ordering | Phone-first lookup for takeaway, car and delivery; saved delivery addresses | `admin/src/screens/OrderEntry.tsx` |
| Tablet | Phone-first lookup on the order details screen; takeaway and car take phone and name; takeaway name now sent (it was dropped before) | `mobile/app/capture.tsx`, `app/review.tsx`, `src/api/` |
| Tests | Server tests 235 → 248 (`customers.test.ts`, bill customer line) | `server/src/__tests__/` |
| Reports | New **Reports** screen: 8 tabs, range picker, totals, **Download CSV** per tab | `admin/src/screens/Reports.tsx` |
| Reports | Discounts & voids CSV is one sheet with a `kind` column; CSV headers include every row's columns | `server/src/index.ts`, `services/reports.ts` |
| Backup | **30-day retention** (newest always kept), **daily backup** when none in 24 h, Backup now, folder setting with write check; shift close always backs up and no longer fails on a bad folder; new `settings.backup_dir` (migration `0010`); `GET/POST /api/backups`, `PUT /api/backups/folder` | `server/src/services/backups.ts`, `shifts.ts`, `reset.ts`, `drizzle/0010_warm_hellcat.sql` |
| Settings | **General / Backup** tabs; Backup tab shows folder, last run, Backup now, recent files | `admin/src/screens/Settings.tsx`, `BackupSettings.tsx` |
| Dashboard | Printer-health and last-backup cards | `admin/src/screens/Dashboard.tsx` |
| Print queue | Panel from the header strip: per-job view, **Retry**, **Discard**, Retry all failed; new status `discarded`; `GET /api/print-jobs?status=`, `POST /api/print-jobs/:id/retry`, `/discard` | `admin/src/components/PrintQueue.tsx`, `Shell.tsx`, `server/src/services/print-jobs.ts` |
| Tests | Server tests 248 → 257 (`backups.test.ts`, CSV columns) | `server/src/__tests__/` |
| Branding | Product named **Zentivo POS** (was "Al Manzil POS", which is the demo customer). Name, colours, ids, installer file name and data folder in one file, `brand/brand.json`; icons from `brand/icon.svg` + `mark.svg` via `pnpm brand` | `brand/`, `tools/brand.mjs` |
| Windows | electron-builder config moved from `package.json` to `electron-builder.cjs` (reads brand.json); app icon, installer/uninstaller icon, tray icon; installer is `ZentivoPOS-Setup-<v>.exe`; app id `com.zentivo.pos`; data folder `%APPDATA%\Zentivo POS`, an old `Al Manzil POS` folder is moved across on first start | `packages/desktop/` |
| Android | `app.config.js` (reads brand.json): name, package `com.zentivo.pos`, launcher + adaptive + themed icon, splash (`expo-splash-screen` added) | `packages/mobile/app.config.js`, `assets/` |
| Web | Tab title and `theme-color` from brand.json, favicon, small brand mark in the sidebar, sign-in and first-time setup | `packages/admin/index.html`, `vite.config.ts`, `components/BrandMark.tsx` |
| Licence tools | Key folder `~/.zentivo-pos/`; a key still in `~/.almanzil-pos/` is found there | `tools/licence.mjs`, `licence-generator.html` |
