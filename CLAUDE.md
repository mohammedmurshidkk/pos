# Restaurant POS — working notes

Single-branch restaurant POS for Dubai. **No cloud.** A Windows PC runs the hub
(server + cashier UI); Android tablets take orders over the LAN; thermal
printers are addressed directly by IP.

The full specification is in `docs/` — read `01-product-spec.md` before changing
behaviour. `02-design-system.md`, `03-screens.md` and `04-stitch-prompts.md`
cover the UI. `05-menu-import.md` covers the menu CSV import.

## Keeping the docs (convention, from 2026-10-04)

**Never delete or overwrite earlier text in `CLAUDE.md` or `docs/`.** When
something changes, leave the old text where it is and add a dated block right
under it:

> **Update YYYY-MM-DD:** what changed, and why.

New screens get their own section marked `new YYYY-MM-DD`. Every change also
gets a line in [`docs/CHANGELOG.md`](docs/CHANGELOG.md), newest first. The point
is that anyone can see what the spec said before and what it says now.

## Layout

```
packages/shared    Drizzle schema, money/tax engine, KOT routing   28 tests
packages/server    Fastify + SQLite, ESC/POS, print queue         227 tests
packages/admin     React + Vite cashier/admin UI (light theme)      8 tests
packages/mobile    Expo waiter app (dark, responsive)              10 tests
packages/desktop   Electron shell — packages server + admin as one .exe
tools/             fake-printer.js · licence.mjs + licence-generator.html (vendor-only licence signing)
```

## Commands

```bash
pnpm -r test && pnpm -r typecheck        # 273 tests
node tools/fake-printer.js 9100 9101 9102 9130
pnpm printer:sim                         # same ports, receipts in a browser at :9180
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

**Licence:** there is **no automatic trial**. A fresh install is `unlicensed`
(blocks new orders and shifts) until the superadmin grants a trial — in
**minutes, hours or days**, from now, replacing any earlier trial; `0` ends it
(`grantTrial`, `settings.trialEndsAt`). A paid licence is an Ed25519-signed
key bound to the install id (`POS1.<payload>.<sig>`). With both, whichever ends
later counts. Expiry blocks **new orders
and new shifts only** — add-on rounds, billing, settling, closing the shift and
reports all keep working, so a lapse never strands a seated table. Since settling
needs a shift, an expired install **can still open a shift while any order is
unsettled** (`canOpenShift`); the cashier UI follows `canOpen` from
`/api/shifts/current`. Winding the PC clock back does not extend it (`clockHighWater`).

The install id lives in the database, not hardware, on purpose: restoring a
backup onto a replacement PC must bring the licence with it.

**No terminal:** open `tools/licence-generator.html` (double-click). Pick the
`.pem`, type install id + customer + value + unit (minutes/hours/days), copy the
key. Signs in the browser, stores nothing. A server test runs the page's signing
code against `parseLicence`, so the two cannot drift. Never host or ship it.

```bash
node tools/licence.mjs sign --install <id> --customer "Al Manzil" --days 365   # or --hours / --minutes
node tools/licence.mjs inspect <key>
```

**The private signing key is `~/.almanzil-pos/licence-private.pem` on the
vendor's Mac. Back it up; never commit it** (`*.pem` is gitignored). Lose it and
no installed shop can be renewed without shipping a build with a new public key
(`packages/server/src/licence-public-key.ts`). Tests use a throwaway keypair via
`POS_LICENCE_PUBLIC_KEY`.

## Superadmin — the way back in

**Ctrl + Alt + Shift + A** anywhere in the cashier UI opens a password modal —
on macOS that is **Control + Option + Shift + A** (⌃⌥⇧A). Matched on
`e.code === 'KeyA'`, never `e.key`: holding Option on macOS rewrites the
character (Option+A arrives as `å`), so a `key` match silently never fires there.
There is no label, no nav item and no route: the door is mounted above the
router (`components/SuperadminDoor.tsx`) so it works **while the sign-in screen
is showing** — which is the whole point, since it exists for "every admin PIN is
forgotten".

> **Update 2026-10-04 (5):** on a touch till with no keyboard, **press and hold
> the brand mark on the sign-in screen for 5 seconds** — same password prompt,
> still no label (`HiddenDoor` in `screens/Login.tsx` fires `OPEN_SUPERADMIN`).

Inside, two tabs:
- **Admins** — add, reset a PIN, enable/disable, change the superadmin password.
- **Clear data** — hand a tested hub over as a fresh one.

Clearing goes in dependency order and the hub says which group to do first
("Clear the Menu first — categories decide which kitchen prints their tickets")
rather than failing with a foreign-key error. **Clear everything** ignores the
order because the whole graph goes at once, and needs the word CLEAR typed.

**Clearing is a hard delete** — `DELETE FROM`, not the `active = false` rule the
rest of the app follows. Those soft deletes exist to protect historical
references; a clear removes the history too, so there is nothing left to point
at the rows.

A backup is written before anything is deleted (`before-clear-*.db`).
Clearing Sales also restarts invoice and order numbering at 1.

**Clear everything also runs `VACUUM` + `wal_checkpoint(TRUNCATE)`.** DELETE
frees pages without overwriting them, so without this the previous shop's menu
and sales stay readable inside `pos.db` — which matters when the same PC is
handed to a different restaurant. A test asserts the text is gone from both the
db and its `-wal` sidecar. Single-group clears do **not** rebuild the file.

⚠️ The `before-clear-*.db` backups are full copies sitting next to the database.
Handing a PC to another client means deleting those too.

> **Update 2026-10-04 (3):** `before-clear-*.db` now goes to the backup folder
> (Settings → Backup; default `backups/` next to the database) with the other
> backups, and is pruned after 30 days like them. Handing a PC over still means
> deleting that folder.

**Never cleared:** install id, trial clock, licence key and the superadmin
password — losing those would cost the shop its licence and lock the superadmin
out of the installation it just reset. After a full clear nobody can sign in,
which is the intended state: the superadmin adds the first admin, and that admin
builds the rest.

The audit log is cleared but deliberately **not counted** — clearing writes its
own audit row, which would otherwise leave the group looking non-empty and block
Employees forever.

- Counter PC only. Every `/api/superadmin/*` route is absent from
  `TABLET_ROUTES`, so a paired tablet gets 403 even with the right password.
- Password is scrypt-hashed in `settings.superadminHash`; 5 wrong tries → 60 s
  lockout; session token is 30 minutes, sliding, memory-only on both ends.
- It **cannot disable the last admin who can sign in** — that state would be
  unrecoverable from the UI.
- Every action is audited (`superadmin.*`). PINs and passwords never enter the log.

**First run.** `seedMinimal` creates only the settings row — **no admin, no
superadmin password, no trial**. With no password set, `SuperadminDoor` shows
**First-time setup** over everything: choose the password (`POST
/api/superadmin/setup`, works once), then the superadmin screen opens on a
checklist — add the first admin with a starting PIN, then grant a trial or
activate a key. The admin signs in and changes the PIN via **Change PIN** in the
header (`/api/auth/change-pin`, needs the current PIN). PINs are exactly
**4 digits** — sign-in submits on the fourth.

Passwords: demo seed = `superadmin1` (and a 30-day trial). Lost it? On the shop's PC:

```bash
pnpm --filter @pos/server superadmin:set -- "a good password"
```

## Menu CSV import

Setup → Categories / Items → **Import CSV**. Columns `category, item, price,
kitchen` (header-mapped, `kitchen` optional). Full reference: `docs/05-menu-import.md`.

- **The sheet names a kitchen, never a printer.** Kitchen → printer is already
  set in Setup, so routing comes for free. Kitchens are **never created** by an
  import (`kitchens.printer_id` is NOT NULL); an unknown name blocks the import.
- **Plan, then apply.** The route's `dryRun` defaults to **true**; only an explicit
  `false` writes. The dialog's KOT routing table (category → kitchen → printer IP)
  is what the operator checks.
- One new category with two different kitchens is an **error**, not last-wins.
- An existing category **keeps its kitchen**; the sheet only warns. Re-routing is a
  deliberate act in Setup.
- Matches by name (case-insensitive; items within their category). Re-import
  updates prices and never duplicates. Nothing missing from the sheet is removed.
- CSV is parsed in the browser (`admin/src/masters/csv.ts`). Each row carries its
  spreadsheet `line`, which the hub uses in error messages. Keep it that way, or
  errors point at the wrong row once blank lines are skipped.
- Prices with more decimals than the currency are **rejected, not rounded**.

## Rules the code depends on

- **Money is integers in minor units.** AED 25.50 is `2550`. The tax rate is
  basis points (`taxRateBp: 500` = 5%). No floats anywhere.
- **`invoice_no` is gapless.** Allocated in a transaction on first bill print.
  A cancelled order keeps its number as a void record; numbers are never reused.
- **Nothing is deleted, only deactivated** — historical rows still reference
  categories, kitchens and employees by id.
- **Snapshot `name` and `unit_price` onto order lines** so a menu price change
  cannot rewrite past invoices.
- **The bill IS the tax invoice — one customer document.** It prints titled TAX
  INVOICE with the invoice number, TRN and VAT breakdown from the first print
  (tablet or counter). Settlement prints only if no bill was printed yet or the
  order changed since (`REVISED`); otherwise cash just pops the drawer (`drawer`
  print job, no paper) and card prints nothing. Old `invoice` jobs still render.
> **Update 2026-10-04:** the bill no longer prints the kitchen note ("no onion").
> Notes print on the KOT only; modifiers still print on both (`renderBill` in
> `server/src/templates.ts`, covered by `escpos.test.ts`).
- **No payment without an open shift.** `settle` refuses when the counter has no
  open shift. A shift-less payment would be on no Z-report. Payment rows carry
  the settling `counterId`, `shiftId` and cashier; the order's `counterId` becomes
  the settling counter (the bill-print counter is not kept).
- **Receipt bytes must stay below 0x80.** `toPrintable()` turns anything higher
  into `?`. The drawer kick was `ESC p 0 0x19 0xFA` and would have reached the
  printer as `0x19 ?`; it is now `0x19 0x78`.
- **The tablet has no login and no void control.** Identity is captured per
  action by the employee picker; voids happen only at the counter. Both are
  deliberate anti-theft decisions, not omissions.
- **`orders.waiterId` (credit, editable) is separate from `createdBy`
  (audit, never editable).** Reports group by `waiterId`.
- **Every discount, void and master change writes to `audit_log`.**

## Status

Done: hub server, KOT routing, billing/settlement, voids, shifts + Z-report,
expenses, reports, master data CRUD, counter sign-in + open counter, licence &
trial expiry, device pairing tokens & tablet access scope, **superadmin (hidden
shortcut, admin management)**, menu CSV import (Setup → Categories/Items), admin UI (billing, settle, shift, printers,
dashboard, setup, devices, licence), waiter app
(responsive, offline queue, pairing by code), Electron shell.

Not done: expenses/reports/settings screens in admin, QR pairing camera,
customer lookup for delivery, 30-day backup retention, a reprint button for
settled orders in the admin UI (the API already reprints them), APK build, app icon, code signing, refunds (deferred by client),
Arabic (deferred).

> **Update 2026-10-04:** built today, all on the counter PC unless noted —
> **Expenses** screen + **Shift → Pay out**; **Bills** (settled/cancelled, search,
> reprint); **order taking at the counter** (+ New order, Add items); Setup item
> form "Asks for (modifier groups)", then the modifier screens **commented out**
> (hidden, not removed); separate **Printers** screen removed (Test print and
> Retry failed prints moved to Setup → Printers); **one-tap settle** (+ Split
> payment for multi-tender); kitchen note off the bill; **tablet: note on a cart
> line** after adding it. Server tests 227 → 235.
>
> Not done now: **reports screen** in admin; Settings **Backup** tab (path, last
> run, Backup Now) and **30-day backup retention**; Dashboard printer-health and
> last-backup strip; print queue detail (per-job view / discard); **A05 floor
> view** and **A17 customers / delivery customer lookup** (P1); QR pairing camera;
> modifier screens (hidden); APK build, app icon, code signing; refunds and
> Arabic (deferred by client).

> **Update 2026-10-04 (2):** built after the list above — **A05 floor view** on the counter
> (sidebar **Floor**); **customers saved by phone** (unique, digits only) from any
> order with a phone; **phone-first lookup** for takeaway, car and delivery on the
> counter and the tablet (fills name and last address); **name and phone asked
> at settle** for every order, printed on the bill. New column
> `orders.customer_name` (migration `0009`). Server tests 235 → 248.
>
> Still not done from that list: reports screen; Settings Backup tab and 30-day
> retention; Dashboard printer/backup strip; print queue detail; a **Customers
> (CRM) screen** (lookup only for now); QR pairing camera; modifier screens
> (hidden); APK build, icon, code signing; refunds and Arabic (deferred).

> **Update 2026-10-04 (3):** built — **Reports** screen (sidebar, 8 tabs, any range,
> CSV per tab); **Settings → Backup** tab (folder, last run, Backup now, recent
> files); **backups** in `server/src/services/backups.ts`: every shift close (now
> even without a folder from the client), **daily** when nothing in 24 h (checked
> hourly from `startServer`), Backup now, before a clear; **30 days kept, newest
> always kept**, only `pos-*.db` / `before-clear-*.db` touched; a failed backup
> no longer blocks closing the shift (`backupError` in the reply, shown on Shift).
> New `settings.backup_dir` (migration `0010`). **Dashboard** printer-health and
> last-backup cards; **print queue panel** with per-job Retry / Discard (new job
> status `discarded`, `GET /api/print-jobs?status=problems|all`,
> `POST /api/print-jobs/:id/retry|discard`). Discounts & voids CSV fixed. Server
> tests 248 → 257.
>
> Still not done: Customers (CRM) screen; QR pairing camera (not needed now);
> modifier screens (hidden); **branding** (app name, icons, favicon) is next;
> APK build, code signing; refunds and Arabic (deferred).

> **Update 2026-10-04 (4):** **branding done.** The product is **Zentivo POS**
> (Al Manzil stays as the demo restaurant). Name, colours, ids, installer file
> name and data folder all come from **`brand/brand.json`**, and the icons from
> `brand/icon.svg` + `brand/mark.svg` via **`pnpm brand`** (generated files are
> committed). Readers: `desktop/electron-builder.cjs` (replaces `build` in
> `package.json`), `desktop/src/main.ts`, `mobile/app.config.js`,
> `admin/vite.config.ts`, `admin/src/brand.ts`, `tools/licence.mjs`. Ids are now
> `com.zentivo.pos`, so old installs need an uninstall first. **Never change
> `ids.*` after a shop installs.** The data folder is pinned by
> `dataFolder`, not the app name, and `legacyDataFolders` moves an old folder
> across. See `brand/README.md`. The vendor key folder is now `~/.zentivo-pos/`,
> with fallback to `~/.almanzil-pos/`.

> **Update 2026-10-04 (5):** **touch-till shell.** The sidebar is gone: one 64px
> **top bar** (Floor · Billing · + New order · printer pill · **More** · Name ▾),
> in `admin/src/components/TopBar.tsx` with the screen list in `nav.ts`. Home is
> **Floor** after every sign-in. **Setup, Settings, Devices and Licence ask for the
> admin's PIN again** (`AdminGate.tsx`, `POST /api/auth/confirm`, shares the
> sign-in lockout, audited `auth.unlock`). The Electron window opens in **kiosk
> mode** (Windows taskbar hidden); Name ▾ → Exit full screen (asks for the PIN)
> or the tray menu leaves it, `POS_KIOSK=0` starts windowed for development. The
> UI reaches Electron only through `window.desktop` from `desktop/src/preload.ts`
> (built to `dist/preload.cjs` by `build:main`).

**The v0.2.0 installer is broken** — it predates the loopback fix above and
cannot reach its own hub. Rebuild before any Windows test.

> **Update 2026-10-05:** **USB printers** (one-PC shops, no network printer):
> Setup → Printers → Connection *USB (this PC)*, pick the Windows printer. The hub
> sends RAW ESC/POS to the Windows spooler through PowerShell
> (`server/src/printer-usb.ts`) — no native module, so nothing to add to the
> better-sqlite3 rebuild dance. Install the printer maker's driver first.
> **Test drawer** sits next to Test print. `POS_USB_FAKE_DIR=<folder>` fakes the
> spooler (bytes appended to `<name>.bin`). Shift close now refuses while any
> order is open or billed; cash settle needs an amount. Server tests 263 → 275.

> **Update 2026-10-08:** **window title bar.** The Electron window has no native
> frame (`frame: false`); the UI draws a 40px bar above everything
> (`admin/src/components/TitleBar.tsx`, desktop only) on every screen, sign-in
> included: **minimise** (comes back full screen), **full screen ⇄ window**
> (kiosk on/off, no PIN — minimise and close already reach the desktop) and
> **close** (asks, then hides to the tray; the hub keeps running). Overlays sit
> under the bar because the app's box below it has `transform` (it becomes the
> containing block for `position: fixed`), so screens use `minHeight: '100%'`,
> not `100vh`. Bridge methods: `minimize`, `close`, `onKioskChange` in
> `desktop/src/preload.ts`, typed in `admin/src/desktop.ts`. Closing the shift
> now shows **Counter closed** (sales, expected/counted, over/short, backup
> result) before the open-counter screen (`CounterClosed` in `OpenCounter.tsx`,
> `closedShift` in the store).

Never verified: **the installer on real Windows**, **a real thermal printer**,
**the APK on a real tablet**.

## Open questions for the client

- Are menu prices VAT-inclusive? (assumed yes)
- Is there a service charge? (assumed 0)
- Printer makes/models on site
- Should add-on rounds by a second waiter split the sales credit?
