# Restaurant POS

Single-branch restaurant POS for Dubai (UAE). Local-only, no cloud.
Windows PC acts as the hub; Android tablets take orders over LAN.

## Running it (macOS dev)

Node 20 required — `nvm use` picks it up from `.nvmrc`.

```bash
pnpm install
```

```bash
cd packages/server && pnpm db:push && pnpm seed
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

## Layout

```
packages/shared    schema (Drizzle), money/tax, KOT routing, ids   — 28 tests
packages/server    Fastify + SQLite, ESC/POS renderer, print queue
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

**46 tests passing** (28 unit + 18 integration), typecheck clean.

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
- WebSocket push, printer health, test print

**Next**
Shifts & Z-report · expenses · reports · then the Expo tablet app.

**Still outstanding from week 1**
A real thermal print over LAN, and a packaged Electron `.exe` verified on Windows.
Neither is reduced by more code — both need hardware on your desk.
