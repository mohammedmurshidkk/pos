# Screen Inventory

**P0** = required for the trial demo · **P1** = before paid conversion · **P2** = v1.1

Admin = Electron on Windows PC, light theme, 1366×768.
Waiter = Expo Android, dark theme, 1280×800 landscape / 390×844 portrait.

---

# A. Admin PC

## A01 · Counter sign-in — P0 · **built**
Admin picks their tile and enters a 4-digit PIN.
- Only **admins** appear — the counter settles money, discounts and voids, and each is stamped with whoever is signed in. Waiters use the tablet, which has no login at all.
- An admin with no PIN set is shown dimmed and disabled, with the reason.
- PIN submits on the fourth digit; the number keys work as well as the on-screen pad.
- Five wrong PINs locks that employee out for 30 seconds. Failures are written to `audit_log`.
- Session lives in `sessionStorage`: reloading the window does not sign the cashier out, closing the app does.
- **States:** choosing · entering PIN · wrong PIN · locked out · no PIN set

## A01b · Open the counter — P0 · **built**
Shown straight after sign-in when no shift is open on this counter.
- Counter selector (hidden when there is only one), opening float with quick amounts
- Nothing can be settled until a shift is open — every payment and drawer expense is stamped with it, and that is what makes the Z-report reconcile
- The chosen counter is remembered per machine in `localStorage`; a till never moves
- **States:** default · no counter configured · hub unreachable

## A02 · Dashboard — P0
The owner's 5-second answer to "how are we doing today?"
- 4 stat tiles: Today's Sales · Orders Count · Open Orders · Cash in Drawer
- Sales by order type (dine-in / takeaway / car / delivery) as a small bar row
- Open orders list — table, waiter, elapsed time, total, status pill
- Printer health strip · last backup timestamp
- **States:** normal · no sales yet today · printer offline warning

> **Update 2026-10-04 (3):** **Printer health and last-backup strip built**, above the stat tiles.
> - **Printers** card: every printer with its online dot, plus "N failed" / "N waiting" tickets per printer. Red edge when a printer is offline or a ticket failed; clicking it opens the print queue (A21)
> - **Last backup** card: "12 min ago", or **Overdue** (nothing in 24 h) / **Failed** with an amber or red edge; clicking it opens Settings → Backup
> - The four stat tiles stay as they were (Sales, Average ticket, VAT, Discounts), not the four in the list above

## A03 · Orders / Billing — P0 · **most important screen**
Where the cashier lives. Two panes.
- **Left:** open orders list, filter chips by order type, search by table/invoice/phone
- **Right:** selected order — lines with qty/price, add item, void line (reason), discount, totals block (subtotal, discount, VAT, total)
- Action bar: `Print Bill` · `Settle` · `Void Order`
- Order header: order no, invoice no (if allocated), type chip, table + area, ticket label, elapsed, and a **`Waiter ▾` selector**
- **`Waiter ▾`** — required for dine-in, defaults to the cashier for takeaway/car, "Counter" for delivery. Admin can reassign it on an open order; every change writes to `audit_log`. `created_by` stays the cashier and is never editable.
- **Voids happen here only** — the tablet cannot void. Voiding a sent line requires a preset reason and fires a `*** CANCELLED ***` ticket to that line's kitchen.
- `Save without KOT` available when adding items, gated on `can_save_without_kot`
- **States:** no order selected · open · billed (invoice no shown, `REVISED` warning if edited after print) · settled (read-only) · void

## A04 · Settle payment — P0 (modal over A03)
- Total due (28/700) · payment mode buttons from master (Cash, SBI Card, Canara Card…)
- Amount field, numeric pad, **quick-cash chips** (exact, 50, 100, 500)
- Multi-tender: added payments list, running Balance Due / Change
- Ref no field appears only when `requires_ref`
- Settle button disabled until `sum(payments) >= total`
- Button label says what will print — the bill is the tax invoice, so settling prints only when needed: **Settle & print bill** (none printed yet) · **Settle & print revised bill** (changed since printing) · **Settle** (bill already in the customer's hand; cash only opens the drawer)
- Refused with a clear message if no shift is open on this counter
- **States:** single tender · split tender · overpay (shows change) · underpay

> **Update 2026-10-04:** **No "Add payment" step.** The amount on screen counts straight away: pick a mode, tap Exact or a cash chip (or leave the amount empty for the full total), then Settle. The old **Add payment** button is now **+ Split payment**, used only for part-cash part-card. A cash overpay still records only the bill amount and shows the change.

> **Update 2026-10-04 (2):** **Name and phone are asked at settle**, for every order type. Phone and Name sit at the top of the dialog, both optional, prefilled from the order when it already has them (takeaway, car, delivery). A known number fills the name ("Returning customer · 3 orders"). On Settle the hub saves the customer (unique by phone) and links the order, so the name and phone print on the bill. A number under 5 digits is refused with a message.

## A05 · Floor view — P1
Area tabs → table grid, same visual language as the waiter app so support can talk staff through it.
- Tile: table name, status colour + label, order count badge, elapsed, total
- **States:** free · occupied · bill printed · multiple orders

> **Update 2026-10-04 (2):** **Built** as sidebar **Floor** (`admin/src/screens/Floor.tsx`).
> - Area chips show how many tables are busy in each; the header counts Free / Occupied / Bill printed across all areas
> - Tile: table name, seats, order-count badge when more than one party, time since the oldest order, combined total, status word. A table is **Bill printed** only when every order on it has had its bill printed
> - Free table → new dine-in order with that table already picked. Occupied table → a sheet listing its orders (open one in Billing) and **+ New order on this table**, as on the tablet
> - Right column: open takeaway, car and delivery orders (named by vehicle, customer or phone), with Takeaway / Car / Delivery buttons to start one
> - Refreshes every 5 seconds, like Billing

## A-SETUP · Setup (masters) — P0 · **built, replaces A06–A09 and A11–A15**
One generic screen for twelve masters: printers, kitchens, counters, categories, items, modifier groups, modifiers, areas, tables, employees, payment modes, expense categories.
- Entity list on the left, table on the right, edit in a modal driven by a field spec
- Nine hand-written CRUD screens would be nine places to forget the audit stamp or a referential guard; adding a master is now a config entry in `packages/admin/src/masters/config.ts`
- **Referential guards** refuse to disable something in use, with a sentence the admin can act on — "1 kitchen(s) still print to this printer"
- Nothing is deleted, only deactivated — historical rows still reference these by id
- Bulk add for tables (A1…A12)
- **Import CSV** (Categories and Items): `category, item, price, kitchen`. Always checks first; the preview's **KOT routing** table (category → kitchen → printer) is what to verify before **Import**. Full reference: [`05-menu-import.md`](05-menu-import.md)
- Employees: setting a PIN here hashes it; the PIN never reaches the database or the audit log in the clear
- **States:** list · empty · create · edit · guard refusal

> **Update 2026-10-04:** - **Items → "Asks for (modifier groups)"** built: tick the groups an item asks for on the tablet and counter (`PUT /api/masters/items/:id/modifier-groups`, replaces the whole set, audited). Before this only the demo seed could link a group to an item.
> - **Then hidden the same day:** the **Modifier groups** and **Modifiers** entries and the item form's "Asks for" section are **commented out** in `admin/src/masters/config.ts` and `admin/src/screens/Masters.tsx`. Uncomment to bring them back. The API, tablet modifier sheet and counter modifier modal are unchanged. Menu CSV import never touched modifiers and still works.
> - **Setup → Printers** now also has **Test print** per row and **Retry failed prints** in the header (moved from A10, below).

## A10 · Printers — P0 · **support-critical**
- List: name, IP:port, width, live status dot, pending job count
- Row actions: **Test Print** · Edit · Disable
- Form: name, IP, port (default 9100), paper width 58/80, enabled
- **States:** online · offline · jobs pending · never tested

> **Update 2026-10-04:** **Removed as a separate screen.** It duplicated Setup → Printers, so the sidebar entry, route and `screens/Printers.tsx` are gone. What only it had moved to Setup → Printers: **Test print** on each enabled printer, and **Retry failed prints** (requeues tickets that gave up after 5 tries, `POST /api/print-jobs/retry`). Live online/offline status stays in the header printer strip.

## A16 · Expenses — P0
- List: date, category, amount, note, paid by, **paid from drawer** flag
- Add form — `paid from drawer` defaults ON during an open shift (this is what makes the Z-report variance correct)
- Filter by date range and category

> **Update 2026-10-04:** **Built.**
> - Sidebar **Expenses**. List: when, category, note, paid by, source (Drawer / Other), amount; footer totals for "from drawer" and all
> - Filters: Today / Yesterday / This week / This month / Pick a day, and category (`GET /api/expenses?preset=…&categoryId=…`, which until today ignored the range)
> - **Add expense** modal: category, amount, note. "Paid from the cash drawer" is on while this counter has an open shift, off and locked when none is
> - Also opened from **Shift → Pay out**, so a mid-shift payout updates the expected drawer straight away
> - Counter PC only: `/api/expenses` is not a tablet route

## A-BILLS · Closed bills — P0 · **new 2026-10-04, built**
Billing lists open orders only, so a settled bill used to be unreachable.
- Sidebar **Bills**. Range chips (same as Expenses), search by invoice, order no, table, label, phone or car; Settled / Cancelled
- Read-only detail: lines with modifiers, payments with mode and ref, totals
- **Reprint bill** for settled orders: same bill endpoint as a first print, never recalculated, same invoice number, `reprint_count` goes up
- `GET /api/orders/closed?preset=…` — settled orders by `settled_at`, cancelled ones by `opened_at`

## A-ORDER · Take an order at the counter — P0 · **new 2026-10-04, built**
The fallback when a tablet breaks, and the normal path for walk-in takeaway. Opened from Billing: **+ New order**, or **Add items** on the selected order.
- Three columns: order details (type, table grid with open-order badges, label, car or delivery fields, waiter) · menu (category chips + search) · cart (qty, note, remove)
- Items with modifier groups open a modal with the same min/max rules as the tablet
- Sends exactly what the tablet sends: one idempotent `POST /api/orders/submit` with a fresh `batchRef`, so KOT routing, licence checks and audit are the same code path
- The signed-in cashier is `created_by`; the chosen waiter gets the sales credit (`waiter_id`, set right after the first send)
- **Save without KOT** only for someone with `can_save_without_kot`

## A17 · Customers — P1
Search by phone. Detail: name, phone, addresses, order history. Created automatically from delivery orders.

> **Update 2026-10-04 (2):** **Customers are saved, unique by phone; the lookup is built, the screen is not** (CRM comes later).
> - Numbers are stored as digits only, so "050 123 4567" and "050-1234567" are one customer. Country codes are not guessed: "0501234567" and "971501234567" stay two
> - Saved automatically from any order that carries a phone (takeaway, car, delivery, or asked at settle). A new name replaces the stored one; a blank never wipes it. Delivery addresses are kept once each, newest first
> - `GET /api/customers/lookup?phone=` (tablet allowed) returns name, saved addresses, order count; `GET /api/customers?q=` searches by part of a number or name (counter only, for the future CRM screen)
> - Orders keep their own `customer_name` and `phone_snapshot`, so editing a customer later never rewrites old bills

## A18 · Reports — P0
Hub with date-range picker (Today / Yesterday / This week / This month / Custom) and export CSV.
- Daily sales summary · Item-wise · Category-wise · Employee-wise · Payment-mode-wise · Order-type-wise · Discounts & voids · Tax summary
- Every money column tabular + right-aligned; every report shows the range and generated-at timestamp in the header
- **States:** loading skeleton · empty range · results

> **Update 2026-10-04 (3):** **Built**, sidebar **Reports** (after Dashboard).
> - Range chips Today / Yesterday / This week / This month / Pick a day (one calendar day), the same picker as Expenses and Bills
> - Tabs: Summary · Items · Categories · Staff · Payments · Order types · Discounts & voids · Tax. Tables have a totals row (averages are not summed)
> - Summary shows how the total adds up: gross − discounts (+ service) = total = net + VAT
> - Header shows the range and "As of HH:MM"; **Refresh**; **Download CSV** for the open tab (`GET /api/reports/:kind?…&format=csv`)
> - **Discounts & voids CSV** is now one sheet with a `kind` column (`discount` / `void`); it used to come out as a single row of JSON. CSV headers now include columns that only later rows have
> - Only settled bills count (revenue is recognised at settle). Voids count by when the void happened

## A19 · Shift open / close — P0
- **Open:** counter select, opening float, confirm
- **Close:** the Z-report from spec §8 — sales by payment mode, cash reconciliation with counted-cash entry, variance highlighted, sales by order type, discounts/voids, VAT, invoice range, top employees
- Actions: `Print Z-Report` · `Close Shift`
- **States:** no shift open · shift open · counting (variance live-calculates) · closed/read-only

## A20 · Settings — P0
Tabbed: Business (name, TRN, address, logo, footer) · Tax & Currency (all of spec §7) · Invoice (prefix, next number, reprint policy) · Backup (path, last run, Backup Now) · License (expiry, machine id) · Default kitchen.

> **Update 2026-10-04 (3):** Settings now has two tabs, **General** (the existing form, unchanged) and **Backup** (built). `#/settings?tab=backup` opens it directly.
> - **Last backup** ("just now", date and time) and **Backup now**
> - Warning when nothing in 24 h, error banner with the reason when the last backup failed
> - **Backup folder**: default is `backups` next to the database (on Windows `%APPDATA%/…/backups`). Any full path can be saved, e.g. `D:\POS Backups` or a USB stick; the hub creates it and test-writes a file first, and refuses a relative path or a folder it cannot write. **Use default folder** goes back
> - List of the newest 10 backups with date and size, total count and size
> - Text states the rule: a backup at every shift close, once a day if no shift closed, 30 days kept, newest always kept

## A21 · Print queue — P0 (slide-over panel)
- Jobs: kind, printer, order/invoice ref, attempts, status, error
- Actions: Retry · Retry all for printer · Discard
- Opened from the header printer strip

> **Update 2026-10-04 (3):** **Built** as a panel (modal) opened from the header printer strip or the Dashboard printers card.
> - Header strip shows a red count per printer and "N failed" / "N waiting"; it stays visible while printer pings are still running if tickets have failed
> - Filters **Needs attention** (failed, waiting, printing; failed first) and **Recent, all** (adds printed and discarded)
> - Each job: status, kind (KOT / Bill / Void slip / Z report / Test page / Cash drawer), what it is (kitchen, invoice, order, table or car plate), printer, time, attempts, last error
> - **Retry** (failed), **Print again** (discarded), **Discard** (waiting or failed; refused while printing). **Retry all failed** and **Check printers** in the header. Both actions are audited
> - New job status `discarded`: never retried automatically. "Retry all for printer" is not a separate button; the API still takes a `printerId`

## A22 · Devices (pairing) — P0 · **built**
- **Pair a tablet** shows the hub's LAN address (and alternates, if the PC has several) with a large **6-digit code** and a live countdown
- The code works once and expires in 10 minutes; the screen notices the new tablet and confirms it by name
- Paired devices table: name, status, last seen, paired on, **Unpair** (with confirmation)
- Unpairing is immediate; the tablet keeps its queued orders until paired again
- **States:** idle · code showing · just paired · unpair confirm · no devices

## A23 · Licence — P0 · **built**
- Status card: *Not licensed yet* / *Free trial* / *Licensed to …* / *Trial ended* / *Licence expired*, with time left (minutes, hours or days) and end date
- **Install ID** with Copy — what the shop sends the supplier
- Paste a licence key → **Activate**; errors say exactly why (wrong installation, expired, not valid)
- Warning banner if the PC clock has been set back
- Header banner on every screen from 7 days before expiry. When expired, the open-counter step still appears while orders are waiting to be settled (payments need a shift); once nothing is left to settle it is skipped so the cashier can read reports and renew
- **States:** unlicensed · trial · active · warning · expired · clock rolled back
- The trial itself is granted from the superadmin screen's **Licence** tab (value + minutes/hours/days), not here

---

# B. Waiter app (Android)

**No login. No session. No lock.** A paired tablet boots straight to Home. Identity is captured per action by the employee picker (W-EMP). The tablet cannot take payment and cannot void.

## A24 · Superadmin — P0 · **built, hidden**
The way back in when every admin PIN has been forgotten.
- Opened by **Ctrl + Alt + Shift + A**, then a password. No label, no nav item, no route — mounted above the router so it works on the sign-in screen, which is where a locked-out shop actually is
- **Admins** tab: add admin · reset an admin's PIN · enable/disable an admin · change the superadmin password
- **Clear data** tab: every group with a live row count — Sales and history, Menu, Areas and tables, Employees, Counters and payment modes, Kitchens, Printers, Paired tablets, Expense categories
- Blocked groups say what to clear first, in words ("Clear the Menu first — categories decide which kitchen prints their tickets"); **Clear everything** needs CLEAR typed
- A backup is written before any delete; clearing Sales restarts invoice numbering at 1
- The licence, trial clock and superadmin password survive a full clear, so the superadmin can sign back in and create the first admin
- Marked **Counter PC only** on screen; tablets are refused by the hub regardless of password
- Refuses to disable the last admin who can still sign in
- **States:** password prompt · wrong password · locked out · list · add · reset PIN · change password · session ended

## W01 · Pairing — P0 · **built**
Hub IP + port, a **6-digit pairing code** from the counter PC, and a name for the tablet.
- Checks the hub answers (`/api/health`) before trying the code, so "wrong wifi" and "wrong code" read differently
- Shows *"This tablet was unpaired from the counter"* when it arrives here after being revoked
- QR scanning is still to do; typing the code takes seconds
- **States:** default · hub not answering · wrong/expired code · locked out · unpaired

## W02 · Connection error — P0
Shown when the device is paired but the hub is unreachable.
- Large icon, "Can't reach the counter", the configured IP in muted monospace, a `Retry` button, and a hint naming the expected wifi SSID
- ⚠️ Never a blank screen, never a crash, never a dead spinner. Support diagnoses this over the phone.

## W03 · Home — P0
**The first screen a waiter sees, every time.** Table grid *is* the home screen — tapping a table is what "dine-in" means, so there is no Dine-in button and nothing is two taps deep.

```
┌──────────────────────────────────────────────────┐
│ Al Manzil          ● Connected                   │
├──────────────────────────────────────────────────┤
│  [ Tables ]   [ Open Orders ③ ]                  │
├──────────────────────────────────────────────────┤
│  Ground Floor │ Family Section │ Terrace │ AC    │
├──────────────────────────────────────────────────┤
│   A1     A2     A3     A4     A5②    A6          │
│   A7     A8     A9     A10    A11    A12         │
├──────────────────────────────────────────────────┤
│   [ Takeaway ]    [ Car ]    [ Delivery ]        │
└──────────────────────────────────────────────────┘
```

- Segmented control: **Tables** / **Open Orders** (with count badge)
- Area tabs → 6-column table grid
- Tile: table name (large), status colour **plus label**, order count badge when >1, elapsed time, total
- Tapping an **occupied** table opens W04
- Bottom bar: three 64px accent-coloured buttons — Takeaway, Car, Delivery
- **Resume banner** when an unsent draft exists: `⚠️ Unsent order for Table A5 · 3 items [Resume] [Discard]` — Android kills backgrounded apps during a rush, and a silently lost order destroys trust
- **States:** free · occupied · bill printed · multiple orders · empty area · offline banner · resume-draft banner

## W04 · Occupied table sheet — P0
The two-customers-one-table case.
- Bottom sheet listing every open order on that table: order no, ticket label, waiter, elapsed, item count, total, status pill
- Full-width `+ New Order on this Table` button beneath
- **States:** one order · multiple orders

## W05 · Order details capture — P0
Shown after choosing a non-dine-in type.
- **Takeaway:** optional name
- **Car:** vehicle number (large, auto-uppercase), optional bay/slot
- **Delivery:** phone first → if known, autofills name + saved addresses; else name + address form
- **States:** new customer · existing customer found · validation error

> **Update 2026-10-04 (2):** Phone first on all three. **Takeaway** and **Car** now also have optional phone and name; **Delivery** needs phone and address. A known number fills the name ("Returning customer · 2 orders") and, for delivery, the last address, with the other saved addresses as chips. The lookup needs the counter; offline the waiter just types. The takeaway name, which was captured but never sent, now reaches the hub and prints on the KOT. The same fields are on the counter's **+ New order** screen.

## W06 · Menu & cart — P0 · **most used screen**
Landscape tablet: category rail left (25%), item grid centre (50%), cart right (25%). Phone: categories as top chips, cart as a bottom sheet with badge.
- Item tile: name, price, greyed + `Unavailable` when off
- Search across items
- Cart line: name, qty stepper (56px), price, note icon, long-press to remove
- Unsent lines can be removed freely — that is **not** a void, nothing has reached the kitchen yet
- Sent lines are read-only. No void control anywhere on the tablet.
- Footer: item count, total, `Send to Kitchen` (full width, primary)
- **States:** empty cart · items in cart · unsent and sent lines visually separated · offline banner

> **Update 2026-10-04:** Cart lines now have **+ Note** / **Edit note** (with the quick-note chips and Remove note). Before this a note could only be added by long-pressing an item before adding it. On a phone the cart sheet closes first so two sheets don't stack. Editing a note to match another line merges the two.

## W07 · Modifier & note sheet — P1
Bottom sheet on item tap when the item has modifier groups. Group title, min/max hint, options with price deltas, free-text note field, qty, `Add to Order`.
- **Plain items need a note path too.** An item with no modifier groups still needs "no ice" or "less spicy". **Long-press any item tile** opens the same sheet with only the note field and qty.
- **States:** with modifier groups · note-only (plain item) · min-select not satisfied (Add disabled)

## W08 · Order review — P0
Confirm before sending. Groups lines **by kitchen** so the waiter sees the split:
```
Arabic Kitchen   1 × Periperi Alfaham
Chinese Kitchen  1 × Chicken Noodles
Juice Corner     1 × Apple Juice
```
- Footer: **`Send to Kitchen`** filled indigo at 2/3 width, **`Save without KOT`** bordered at 1/3 width
- `Save without KOT` is hidden unless the picked employee has `can_save_without_kot`, and opens a confirm sheet: *"Kitchen will NOT receive this order. It will only be added to the bill."*
- Either action first opens **W-EMP**, then fires — instant success toast, never a blocking spinner
- **States:** first send · add-on send (amber `ADD-ON — will print as KOT #2` banner) · save-without-KOT confirm

## W-EMP · Employee picker — P0 · **new**
Bottom sheet over the current screen. Triggered by `Send to Kitchen`, `Save without KOT` and `Print Bill`.
- Title: **"Who is taking this order?"**
- 4-across grid of 120px tiles — indigo circle avatar with initials, name at 17px/600
- **One tap commits.** No confirm button — the pick *is* the confirmation
- **No pre-selection.** Never highlight the last person used
- Full-width 56px `Cancel` at the bottom
- Success toast names them: `KOT sent · Rahul`
- Only active employees appear
- **States:** default · single employee (still requires the tap) · dormant PIN step (`require_pin_on_action`, not built in MVP)

## W09 · Open order — P0
- Header: order no, type chip, table + label, elapsed, total, waiter name
- Lines with `SENT` / `NEW` status. Sent lines are read-only — **to void, the waiter goes to the counter**
- Actions: `Add Items` · `Print Bill` · `Change Table` (→ W13)
- **Any waiter may add to any open order.** Rahul opens Table A5, Anees adds the next round — allowed, because that is how a floor actually works. The order still credits Rahul via `waiter_id`; the new lines record Anees via `order_items.created_by`. The order header shows the owner, and lines added by someone else show that name.
- **States:** open · billed (read-only lines, reprint available) · settled (read-only)

## W10 · Print bill — P0 (modal)
- Totals summary
- **Counter selector** — preselected to this device's default, changeable; the change becomes the new default
- Opens **W-EMP** before printing
- Reprint shows a `REVISED / REPRINT #n` warning
- ⚠️ No payment UI. The waiter never takes money.

## W11 · Open Orders — P1
All open orders on the device (not "my orders" — there is no session), filterable by waiter. Doubles as a shift handover view.

## W12 · Device settings & diagnostics — P0 · **support-critical**
Without this, a changed hub IP means uninstalling and reinstalling the APK on site.
- Shows: device name, hub IP:port, connection status, last sync, app version, paired-on date
- Actions: `Test Connection` · `Refresh Menu` · `Re-pair Device` (→ W01)
- **Entry is deliberately obscure** — long-press the restaurant name in the header for 2 seconds. Hidden from waiters, findable by support over the phone.
- **States:** connected · disconnected · testing · re-pair confirm

## W13 · Change table — P0
Guests get moved constantly, so this is used more than you'd expect.
- Bottom sheet, same tile language as W03, **free tables only** plus the current table marked `CURRENT`
- Area tabs across the top
- Tap a free table → confirm sheet naming both tables → move
- **States:** default · no free tables in this area · confirm

# Build order for screens

| Week | Screens |
|---|---|
| 1 | A01, A10, A09, A07, A06, A22 |
| 2 | W01, W02, W03, W04, W05, W06, **W-EMP**, W08, W12 |
| 3 | W09, W10, W13, A03, A04, A14 |
| 4 | A02, A16, A18, A19, A20, A21, A11, A12, A13 |

**W-EMP is on the week-2 critical path** — nothing on the tablet can be recorded without it.
