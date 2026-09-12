# Restaurant POS

Single-branch restaurant POS for Dubai (UAE). Local-only, no cloud.
Windows PC acts as the hub; Android tablets take orders over LAN.

## Running it (macOS dev)

Node 20 required — `nvm use` picks it up from `.nvmrc`.

```bash
pnpm install
```

```bash
cd packages/server && pnpm db:migrate && pnpm seed
```

Terminal 1 — fake printers (Arabic :9100, Chinese :9101, Juice :9102, Counter :9130):

```bash
pnpm fake-printers
```

Terminal 2 — the hub:

```bash
cd packages/server && pnpm dev
```

Tests and typecheck:

```bash
pnpm -r test && pnpm -r typecheck
```

Tablet app (Android device on the same wifi as your Mac):

```bash
cd packages/mobile && pnpm start
```

Pair it with your Mac's LAN IP — `ipconfig getifaddr en0` — port 4000.

## Layout

```
packages/shared    schema (Drizzle), money/tax, KOT routing, ids   — 28 tests
packages/server    Fastify + SQLite, ESC/POS renderer, print queue  — 57 tests
packages/mobile    Expo waiter app (expo-router, zustand)
packages/admin     React + Vite cashier/admin UI (light theme)
tools/             fake-printer.js
docs/              spec, design system, screens, Stitch prompts
```

## Docs

| File | What's in it |
|---|---|
| [docs/01-product-spec.md](docs/01-product-spec.md) | Stakeholders, scope, architecture, data model, flows, tax rules, build order |
| [docs/02-design-system.md](docs/02-design-system.md) | Colour tokens, typography, touch targets, component rules |
| [docs/03-screens.md](docs/03-screens.md) | Every screen: purpose, elements, states, priority |
| [docs/04-stitch-prompts.md](docs/04-stitch-prompts.md) | Stitch prompts — 14 waiter screens, 8 admin |

## Status

**123 tests passing** (43 unit + 80 integration), typecheck clean.

**Working**
- Money/tax engine — inclusive & exclusive, discounts, service charge, 2- and 3-decimal currencies
- KOT routing — multi-kitchen split, add-on rounds, default-kitchen fallback
- Print queue — one serial worker per printer, connect timeout, backoff, retry-all
- Orders — create, add lines, send to kitchen, save-without-KOT (permission gated)
- Billing — BILL vs TAX INVOICE, gapless invoice numbers, REVISED/REPRINT marking
- Payments — split tenders across merchant accounts, partial payment, change due
- Voids — line and order, cancellation tickets to the right kitchen, reason required
- Discounts — percent/amount, permission + cap, audited
- Attribution — `waiterId` vs `createdBy`, admin reassignment
- Shifts — one per counter, auto-attached to payments and expenses
- Z-report — sales by payment mode, cash reconciliation, variance, by order type,
  by waiter, discounts/voids/no-KOT counts, VAT, invoice range
- Expenses — drawer-paid expenses reduce expected cash
- Backup — `VACUUM INTO` snapshot on shift close
- Reports — summary, item-wise, category-wise, employee-wise, payment-mode,
  order-type, discounts & voids, tax summary; date presets with a configurable
  business-day rollover hour; CSV export
- WebSocket push, printer health, test print

**The hub is feature-complete for the MVP.**

**Tablet app — running on device, responsive**
Pair · Home (table grid) · Occupied-table sheet · Capture (takeaway/car/delivery) ·
Menu & cart · Modifier sheet · Note sheet · Review · Employee picker ·
Order detail · Print bill · Change table · Device settings

Responsive across Material window size classes — compact (phone), medium
(phone landscape / tablet portrait), expanded (tablet landscape, 3 panes).

**Offline queue** — orders taken while the counter is unreachable are held and
sent automatically on reconnect. Safe because every send carries a client
`batchRef` that the hub treats as a no-op on replay.

**Admin UI — billing, settlement, shift/Z-report, printers, dashboard**
Runs at 1366x768. Voids and discounts happen here only, attributed to the
signed-in operator.

**Master data** — twelve masters behind one generic CRUD layer: printers,
kitchens, counters, categories, items, modifier groups/modifiers, areas,
tables, employees, payment modes, expense categories. Zod validation,
referential guards, audit trail, deactivate-never-delete.

**Electron shell** — `pnpm --filter @pos/desktop dist:win` produces a Windows
installer. CI workflow in `.github/workflows/build-windows.yml` is the
reliable path; cross-building from macOS needs `native:win` first.

**Next**
Expenses & reports screens · settings screen · QR pairing · APK build · app icon.

**Still outstanding from week 1**
A real thermal print over LAN, and a packaged Electron `.exe` verified on Windows.
Neither is reduced by more code — both need hardware on your desk.
