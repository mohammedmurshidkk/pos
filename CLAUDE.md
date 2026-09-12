# Restaurant POS — working notes

Single-branch restaurant POS for Dubai. **No cloud.** A Windows PC runs the hub
(server + cashier UI); Android tablets take orders over the LAN; thermal
printers are addressed directly by IP.

The full specification is in `docs/` — read `01-product-spec.md` before changing
behaviour. `02-design-system.md`, `03-screens.md` and `04-stitch-prompts.md`
cover the UI.

## Layout

```
packages/shared    Drizzle schema, money/tax engine, KOT routing   28 tests
packages/server    Fastify + SQLite, ESC/POS, print queue          87 tests
packages/admin     React + Vite cashier/admin UI (light theme)
packages/mobile    Expo waiter app (dark, responsive)               8 tests
packages/desktop   Electron shell — packages server + admin as one .exe
tools/             fake-printer.js — TCP listeners that print to console
```

## Commands

```bash
pnpm -r test && pnpm -r typecheck        # 123 tests
node tools/fake-printer.js 9100 9101 9102 9130
cd packages/server && pnpm dev           # hub on :4000
cd packages/admin  && pnpm dev           # cashier UI on :5173 (proxies /api)
cd packages/mobile && pnpm start         # Expo
```

## Gotchas that have already cost time

**better-sqlite3 is a native module with three incompatible builds.** Electron
and Node have different ABIs; Windows needs its own binary. Switch with:

```bash
pnpm --filter @pos/desktop native:node       # tests + pnpm dev  (default)
pnpm --filter @pos/desktop native:electron   # running the Electron app
pnpm --filter @pos/desktop native:win        # before dist:win
```

`dist:win` leaves the Windows binary in place — run `native:node` afterwards or
every test fails with `NODE_MODULE_VERSION`. pnpm keeps **two** copies
(hoisted + `.pnpm` store) and the packager reads the store one; `scripts/native.mjs`
patches both. A Windows installer once shipped a macOS binary because only one
was patched, and the build log looked identical. **Always check the packaged
binary**, not the log:

```bash
find packages/desktop/release/win-unpacked -name "*.node" -exec file {} \;
```

**`.npmrc` sets `node-linker=hoisted`** because Metro cannot resolve pnpm's
symlinked modules. A side effect: one `@types/react` for the whole workspace, so
**React versions cannot diverge between packages** (all on 19).

**EAS and GitHub Actions build from git, not your working directory.** Commit
before every build or you get a confusing failure — a stale `pnpm-lock.yaml`
that no longer matches the `package.json` files.

**A React Native release build needs ~8GB free disk.** One attempt filled the
disk to 431MB and failed. Prefer `.github/workflows/build-apk.yml`.

**Don't send `content-type: application/json` on a body-less request** —
Fastify's parser throws and the 500 hides the real error message.

## Rules the code depends on

- **Money is integers in minor units.** AED 25.50 is `2550`. The tax rate is
  basis points (`taxRateBp: 500` = 5%). No floats anywhere.
- **`invoice_no` is gapless.** Allocated in a transaction on first bill print.
  A cancelled order keeps its number as a void record; numbers are never reused.
- **Nothing is deleted, only deactivated** — historical rows still reference
  categories, kitchens and employees by id.
- **Snapshot `name` and `unit_price` onto order lines** so a menu price change
  cannot rewrite past invoices.
- **BILL ≠ TAX INVOICE.** The bill is the customer's check; the tax invoice is
  issued at settlement with TRN and VAT breakdown.
- **The tablet has no login and no void control.** Identity is captured per
  action by the employee picker; voids happen only at the counter. Both are
  deliberate anti-theft decisions, not omissions.
- **`orders.waiterId` (credit, editable) is separate from `createdBy`
  (audit, never editable).** Reports group by `waiterId`.
- **Every discount, void and master change writes to `audit_log`.**

## Status

Done: hub server, KOT routing, billing/settlement, voids, shifts + Z-report,
expenses, reports, master data CRUD, admin UI (billing, settle, shift,
printers, dashboard, setup), waiter app (13 screens, responsive), Electron
Windows installer.

Not done: expenses/reports/settings screens in admin, QR pairing camera,
APK build, app icon, code signing, refunds after settlement (deferred by the
client), Arabic (deferred).

Never verified: **the installer on real Windows**, and **a real thermal
printer**. Both need hardware. Everything so far is the fake printer and a
cross-build.

## Open questions for the client

- Are menu prices VAT-inclusive? (assumed yes)
- Is there a service charge? (assumed 0)
- Printer makes/models on site
- Should add-on rounds by a second waiter split the sales credit?
