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
packages/server    Fastify + SQLite, ESC/POS, print queue         131 tests
packages/admin     React + Vite cashier/admin UI (light theme)
packages/mobile    Expo waiter app (dark, responsive)              10 tests
packages/desktop   Electron shell — packages server + admin as one .exe
tools/             fake-printer.js · licence.mjs (vendor-only licence signing)
```

## Commands

```bash
pnpm -r test && pnpm -r typecheck        # 169 tests
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

**Android blocks plain HTTP in release builds.** `packages/mobile/plugins/withCleartextTraffic.js`
turns it back on — `usesCleartextTraffic` in `app.json` silently does nothing.
Without the plugin a release APK installs, launches, then fails every request.

**The hub serves the admin UI; Electron loads `http://127.0.0.1:4000/`.** Never
go back to `loadFile()` — the UI's relative `/api` calls resolve to
`file:///api/...` from disk and the app sits on "Cannot reach the hub".

## Access, pairing and licensing

**Who may call the hub** (`onRequest` hook in `packages/server/src/index.ts`):
- **Counter PC** = loopback, read from the socket (never `X-Forwarded-For`). Full access.
- **Tablet** = valid `x-device-token`. Only the routes in `TABLET_ROUTES` —
  no settle, void, discount, masters, reports, licence. Add a tablet route
  there deliberately or it gets 403.
- **Public** = `GET /api/health`, `POST /api/devices/pair`.
- A token **always wins**, even from loopback — `adb reverse` makes an emulator
  arrive as 127.0.0.1 and it must still be scoped as a tablet.

**Pairing:** Devices screen issues a 6-digit code (single use, 10 minutes,
5 wrong tries → 60 s lockout). The tablet exchanges it for a 256-bit token,
stored hashed. Unpair takes effect on the next request; the tablet goes back to
the pairing screen and **keeps its queued orders** (401 is not a rejection).

**Licence:** 30-day trial starts on first run. A paid licence is an Ed25519-signed
key bound to the install id (`POS1.<payload>.<sig>`). Expiry blocks **new orders
and new shifts only** — add-on rounds, billing, settling, closing the shift and
reports all keep working, so a lapse never strands a seated table. Winding the
PC clock back does not extend it (`clockHighWater`).

The install id lives in the database, not hardware, on purpose: restoring a
backup onto a replacement PC must bring the licence with it.

```bash
node tools/licence.mjs sign --install <id> --customer "Al Manzil" --days 365
node tools/licence.mjs inspect <key>
```

**The private signing key is `~/.almanzil-pos/licence-private.pem` on the
vendor's Mac. Back it up; never commit it** (`*.pem` is gitignored). Lose it and
no installed shop can be renewed without shipping a build with a new public key
(`packages/server/src/licence-public-key.ts`). Tests use a throwaway keypair via
`POS_LICENCE_PUBLIC_KEY`.

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
expenses, reports, master data CRUD, counter sign-in + open counter, **licence &
trial expiry, device pairing tokens & tablet access scope**, admin UI (billing,
settle, shift, printers, dashboard, setup, devices, licence), waiter app
(responsive, offline queue, pairing by code), Electron shell.

Not done: expenses/reports/settings screens in admin, QR pairing camera,
customer lookup for delivery, 30-day backup retention, invoice reprint after
settlement, APK build, app icon, code signing, refunds (deferred by client),
Arabic (deferred).

**The v0.2.0 installer is broken** — it predates the loopback fix above and
cannot reach its own hub. Rebuild before any Windows test.

Never verified: **the installer on real Windows**, **a real thermal printer**,
**the APK on a real tablet**.

## Open questions for the client

- Are menu prices VAT-inclusive? (assumed yes)
- Is there a service charge? (assumed 0)
- Printer makes/models on site
- Should add-on rounds by a second waiter split the sales credit?
