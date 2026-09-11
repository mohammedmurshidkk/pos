# Screen Inventory

**P0** = required for the trial demo · **P1** = before paid conversion · **P2** = v1.1

Admin = Electron on Windows PC, light theme, 1366×768.
Waiter = Expo Android, dark theme, 1280×800 landscape / 390×844 portrait.

---

# A. Admin PC

## A01 · Login — P0
Employee picks their name, enters PIN. Admin can switch to username + password.
- Tiles of active employees with initials avatar · 4-digit PIN pad (64px keys) · error shake on wrong PIN
- **States:** default · wrong PIN · account inactive · license expiring banner

## A02 · Dashboard — P0
The owner's 5-second answer to "how are we doing today?"
- 4 stat tiles: Today's Sales · Orders Count · Open Orders · Cash in Drawer
- Sales by order type (dine-in / takeaway / car / delivery) as a small bar row
- Open orders list — table, waiter, elapsed time, total, status pill
- Printer health strip · last backup timestamp
- **States:** normal · no sales yet today · printer offline warning

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
- **States:** single tender · split tender · overpay (shows change) · underpay

## A05 · Floor view — P1
Area tabs → table grid, same visual language as the waiter app so support can talk staff through it.
- Tile: table name, status colour + label, order count badge, elapsed, total
- **States:** free · occupied · bill printed · multiple orders

## A06 · Items — P0
- Searchable table: name, category, price, availability toggle, sort
- Bulk availability toggle (86'ing an item during service must be one tap)
- Form: name, category, price, modifier groups, sort, active
- **States:** list · empty · create · edit · validation error

## A07 · Categories — P0
List + form: name, **kitchen** (dropdown, this is the KOT routing), sort, active.
- Show the resolved kitchen + printer IP inline so mistakes are visible: `Alfaham → Arabic Kitchen (192.168.1.15)`
- Warn if a category has no kitchen: `Will print to default kitchen`

## A08 · Modifiers — P1
Modifier groups (name, min/max select) → modifiers (name, price delta). Assign groups to items.

## A09 · Kitchens — P0
List + form: name, printer, active. Shows category count using each kitchen.

## A10 · Printers — P0 · **support-critical**
- List: name, IP:port, width, live status dot, pending job count
- Row actions: **Test Print** · Edit · Disable
- Form: name, IP, port (default 9100), paper width 58/80, enabled
- **States:** online · offline · jobs pending · never tested

## A11 · Counters — P0
List + form: name, printer, active. This PC's own counter is set here and marked `THIS DEVICE`.

## A12 · Payment modes — P0
List + form: name, type (cash/card/wallet/credit/online), merchant name, terminal ID, requires ref, opens cash drawer, counts in cash closing, sort, active.
- Example rows: `Cash` · `SBI Card` · `Canara Card`

## A13 · Employees — P0
List + form: name, role (admin/waiter), PIN, can discount, max discount %, **can save without KOT**, active.
- Never display stored PINs. Reset only.
- PIN is used by the **admin PC only** in MVP. The tablet picker does not ask for it — see the dormant `require_pin_on_action` seam in the spec.

## A14 · Areas & tables — P0
Areas list → tables under each. Table: name, seats, sort, active. Bulk add (`A1–A12`).

## A15 · Expense categories — P1
Simple list + form.

## A16 · Expenses — P0
- List: date, category, amount, note, paid by, **paid from drawer** flag
- Add form — `paid from drawer` defaults ON during an open shift (this is what makes the Z-report variance correct)
- Filter by date range and category

## A17 · Customers — P1
Search by phone. Detail: name, phone, addresses, order history. Created automatically from delivery orders.

## A18 · Reports — P0
Hub with date-range picker (Today / Yesterday / This week / This month / Custom) and export CSV.
- Daily sales summary · Item-wise · Category-wise · Employee-wise · Payment-mode-wise · Order-type-wise · Discounts & voids · Tax summary
- Every money column tabular + right-aligned; every report shows the range and generated-at timestamp in the header
- **States:** loading skeleton · empty range · results

## A19 · Shift open / close — P0
- **Open:** counter select, opening float, confirm
- **Close:** the Z-report from spec §8 — sales by payment mode, cash reconciliation with counted-cash entry, variance highlighted, sales by order type, discounts/voids, VAT, invoice range, top employees
- Actions: `Print Z-Report` · `Close Shift`
- **States:** no shift open · shift open · counting (variance live-calculates) · closed/read-only

## A20 · Settings — P0
Tabbed: Business (name, TRN, address, logo, footer) · Tax & Currency (all of spec §7) · Invoice (prefix, next number, reprint policy) · Backup (path, last run, Backup Now) · License (expiry, machine id) · Default kitchen.

## A21 · Print queue — P0 (slide-over panel)
- Jobs: kind, printer, order/invoice ref, attempts, status, error
- Actions: Retry · Retry all for printer · Discard
- Opened from the header printer strip

## A22 · Device pairing — P0
Full-screen **QR code** encoding `{ip, port, pair_token}`, plus the IP in large text as a manual fallback.
- Paired devices list: name, type, last seen, default counter, Unpair

---

# B. Waiter app (Android)

**No login. No session. No lock.** A paired tablet boots straight to Home. Identity is captured per action by the employee picker (W-EMP). The tablet cannot take payment and cannot void.

## W01 · Pairing — P0
Camera view, scan the QR from A22. Manual IP entry fallback. Connection test → success.
- Support does this once during installation. A waiter should never see it.
- **States:** scanning · connecting · failed (with a "check you're on the shop wifi" hint) · paired

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

## W06 · Menu & cart — P0 · **most used screen**
Landscape tablet: category rail left (25%), item grid centre (50%), cart right (25%). Phone: categories as top chips, cart as a bottom sheet with badge.
- Item tile: name, price, greyed + `Unavailable` when off
- Search across items
- Cart line: name, qty stepper (56px), price, note icon, long-press to remove
- Unsent lines can be removed freely — that is **not** a void, nothing has reached the kitchen yet
- Sent lines are read-only. No void control anywhere on the tablet.
- Footer: item count, total, `Send to Kitchen` (full width, primary)
- **States:** empty cart · items in cart · unsent and sent lines visually separated · offline banner

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
