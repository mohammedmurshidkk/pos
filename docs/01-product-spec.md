# Restaurant POS — Product Specification (MVP)

> Working product name: **[TBD]** — replace throughout before client demo.
> Target: single-branch restaurant, Dubai (UAE). 1-month free trial → paid SaaS.
> Team: 1 developer, 1 support/requirements. Timeline: 4 weeks to demo.

---

## 1. Stakeholders

| Stakeholder | Uses | Cares about | Fails if |
|---|---|---|---|
| **Restaurant owner** (buyer) | Admin PC, reports | Daily revenue, staff accountability, no downtime | Reports are wrong or he can't see today's sales in 5 seconds |
| **Cashier / Admin** | Admin PC (Electron) | Fast billing, accurate shift close | Cash variance every night, or billing takes >30s |
| **Waiter** | Android tablet/phone | Speed, few taps, order never lost | Order doesn't reach kitchen, or app is slow during rush |
| **Kitchen staff** | Printed KOT only | Legible ticket, correct station | Ticket goes to wrong kitchen, or add-ons reprint old items |
| **Tech support** (your colleague) | Admin PC diagnostics | Printer status, test print, backup verification | Cannot diagnose a printer issue over the phone |
| **Developer** (you) | Everything | Ship in 4 weeks, low support load | Windows-specific bug found on delivery day |

### Buying decision
The owner converts the trial to paid if: **billing is fast, KOT routing never fails, and the closing report matches the cash drawer.** Everything else is secondary.

---

## 2. Scope

### In scope (MVP)
- Order taking: dine-in, takeaway, car, delivery
- Employee identified per action on the tablet — no login, no sessions
- Save an already-served order without printing a KOT
- Multi-station KOT routing by category
- Add-on KOTs and cancellation tickets
- Table & area management, multiple concurrent orders per table
- Billing, discounts, multi-tender payments, multiple merchant accounts
- Invoice with VAT + TRN, gapless numbering
- Expenses, shift open/close (Z-report)
- Reports: sales, item-wise, category-wise, employee-wise, payment-mode, order-type, discount/void, tax summary
- Masters: printer, counter, kitchen, category, item, modifier, employee, area, table, payment mode, expense category
- Local backup

### Explicitly out of scope
Cloud sync · multi-branch · refunds/credit notes after settlement · **voiding from the tablet** · tablet PIN authentication · Arabic UI · inventory & recipes · loyalty/CRM · aggregator integration (Talabat/Deliveroo/Careem) · driver assignment · payroll · accounting export · floor-plan designer · line-level discounts · KDS screens

### Deferred to v1.1 (mention to client, don't build)
Refunds & credit notes · line-level discounts · bill split/merge · Arabic receipts · kitchen display screens · cloud backup

---

## 3. Architecture

```
┌─────────────────────────── LAN (single branch) ───────────────────────────┐
│                                                                            │
│   Windows PC  ──  HUB (Electron)                                           │
│                    ├── Fastify server  :4000                               │
│                    ├── SQLite (WAL)  ← single source of truth              │
│                    ├── Print queue (1 serial worker per printer)           │
│                    └── Admin UI (React, in Electron window)                │
│                          ▲                    │                            │
│         WebSocket + REST │                    │ ESC/POS over TCP :9100     │
│                          │                    ▼                            │
│   Android tablets ───────┘        Thermal printers (LAN, static IP)        │
│   (Expo APK, order taking)        · Arabic kitchen  192.168.1.15           │
│                                    · Chinese kitchen 192.168.1.20          │
│                                    · Juice corner    192.168.1.21           │
│                                    · Counter 1       192.168.1.30           │
└────────────────────────────────────────────────────────────────────────────┘
```

**No cloud in MVP.** All data and reports are local.

### Stack

| Layer | Choice | Why |
|---|---|---|
| Hub server | Node 20 + Fastify + better-sqlite3 + Drizzle ORM | Drizzle over Prisma — no binary engine to bundle in Electron |
| Hub shell | Electron | One installer, tray icon, auto-start, no terminal for the owner |
| Admin UI | React + Vite + Tailwind | Served by hub |
| Order app | React Native (Expo), APK via EAS | Sideloaded on tablets |
| Realtime | WebSocket (`ws`) | Works when internet is down |
| Printing | ESC/POS raw bytes over TCP:9100, plain text mode | Platform-neutral; no Arabic ⇒ no rasterisation needed |

### Repo layout
```
packages/
  server/    Fastify + SQLite + printing. Runs headless with `node`. No Electron import.
  admin/     React + Vite
  desktop/   Electron shell — thin. Spawns server, loads admin UI.
  mobile/    Expo order app
tools/
  fake-printer.js   TCP listener on :9100 that prints received bytes to console
```
Keeping `server/` free of Electron imports is what lets the whole thing be developed on macOS.

---

## 4. Master data chain

```
Printer (name, ip, port, width)
   ├──► Counter (name, printer_id)              → prints invoices
   └──► Kitchen (name, printer_id)              → prints KOTs
             └──► Category (name, kitchen_id)
                       └──► Item (name, category_id, price)

Area ──► Table (area_id, name, seats)
Employee (name, role, pin, permissions)
Payment Mode (name, type, merchant, terminal_id)
Expense Category
Device (tablet/counter_pc pairing, default_counter_id)
Settings (single row)
```

One printer may serve many counters/kitchens. A single-printer shop creates one kitchen ("Main Kitchen") pointing at the same printer as the counter — same code path, no special case.

Categories and items can be bulk-loaded from a CSV (`category, item, price, kitchen`). The sheet names a **kitchen**, never a printer, and the import never creates kitchens. So printers and kitchens are set up first, and the menu is imported on top. See [`05-menu-import.md`](05-menu-import.md).

---

## 5. Data model

### Masters
```
printers            id, name, ip, port(9100), width(58|80), enabled
kitchens            id, name, name_ar?, printer_id, active
counters            id, name, printer_id, active
categories          id, name, name_ar?, kitchen_id?, sort, active
items               id, category_id, name, name_ar?, price, is_available, sort
modifier_groups     id, name, min_select, max_select
modifiers           id, group_id, name, price_delta
item_modifier_groups item_id, group_id
areas               id, name, sort, active
tables              id, area_id, name, seats, sort, active
employees           id, name, role(admin|waiter), pin_hash,
                    can_discount, max_discount_percent,
                    can_save_without_kot, active
payment_modes       id, name, type(cash|card|wallet|credit|online),
                    merchant_name, terminal_id, requires_ref,
                    opens_cash_drawer, counts_in_cash_closing, active, sort
expense_categories  id, name, active
devices             id, name, type(tablet|counter_pc), pair_token,
                    default_counter_id, last_seen, active
settings            single row — see §7
```

### Transactions
```
orders          id, order_no, type(dine_in|takeaway|car|delivery),
                status(open|billed|settled|void),
                table_id?, ticket_label?, customer_id?,
                address_snapshot?, phone_snapshot?, vehicle_no?, bay_no?,
                waiter_id, created_by, opened_at, billed_at, settled_at,
                subtotal, discount_type, discount_value, discount_amount,
                discount_reason, discount_by,
                service_charge, tax_amount, total,
                invoice_no?, counter_id?, reprint_count

order_items     id, order_id, item_id, name_snapshot, qty,
                unit_price_snapshot, modifiers_json, note,
                status(new|sent|void), kot_suppressed, void_reason,
                created_by, created_at

kot_tickets     id, order_id, kitchen_id, seq, kind(new|addon|void),
                lines_json, printed_at, status

payments        id, order_id, payment_mode_id, amount, ref_no,
                counter_id, shift_id, created_by, created_at

print_jobs      id, printer_id, kind(kot|invoice|void|report),
                payload_json, status(pending|printing|done|failed),
                attempts, last_error, created_at

shifts          id, employee_id, counter_id, opened_at, closed_at,
                opening_float, counted_cash, expected_cash, variance

expenses        id, expense_category_id, amount, note, paid_by,
                shift_id, paid_from_drawer, created_at

customers       id, name, phone (unique), created_at
customer_addresses id, customer_id, label, area, building, flat, landmark, notes

audit_log       id, employee_id, action, entity, entity_id, detail_json, created_at
```

### Five rules that must not be broken
1. **UUIDv7 primary keys** — generated offline on any device, time-sortable, no collisions.
2. **Snapshot `name` and `unit_price` onto `order_items`.** Menu price changes must never rewrite past invoices.
3. **Money as integers in minor units.** AED 25.50 → `2550`. Never floats.
4. **Never delete.** Void with reason + employee id. The audit log is a selling feature.
5. **`invoice_no` is gapless and sequential.** Allocated inside a transaction. Voided numbers are retained as void records, never reused, never deleted.

### Identity is two columns, never one

| | `created_by` | `waiter_id` |
|---|---|---|
| Meaning | who physically keyed it | who serves it / gets the credit |
| Printed on KOT & bill | no | **yes** |
| Employee-wise sales report | no | **yes** |
| Audit log / disputes | **yes** | no |
| Editable later | **never** | admin only, always logged |

- **Tablet:** both are set to the employee picked in the action sheet. Identical, zero extra taps.
- **Counter PC:** `created_by` = the logged-in cashier. `waiter_id` comes from a `Waiter ▾` selector — required for dine-in, defaults to the cashier for takeaway/car, "Counter" for delivery.
- **Order owner is the first picker.** `waiter_id` is set by whoever sends the first KOT. Add-on rounds still stamp `order_items.created_by` per line, so if Anees adds a round to Rahul's table the trail is complete — but the sale credits Rahul.
- **Any waiter may add to any open order.** No ownership lock. Rahul opens Table A5, Anees adds the next round — allowed, because blocking it would send Anees hunting for Rahul mid-service. The order header shows the owner; lines added by another waiter display that name.

---

## 6. Key flows

### 6.1 Order → kitchen
```
waiter selects area → table → (new order, even if table already occupied)
  → picks items + modifiers + notes
  → SEND TO KITCHEN
      group unsent lines by item.category.kitchen_id ?? settings.default_kitchen_id
      one kot_ticket + one print_job per kitchen
      mark lines status = 'sent'
      return OK to tablet immediately (never block on printing)
```
Your example — 1 periperi alfaham + 1 chicken noodles + 1 apple juice — produces **3 tickets to 3 IPs**. A single-printer shop produces 1.

**Add-ons:** second round → new KOT headed `KOT #2 (ADD-ON)` containing only the new lines. Never reprint earlier lines.

**Voids after sending:** must print `*** CANCELLED ***` to the same kitchen — item, qty, who cancelled. Otherwise the kitchen cooks food nobody ordered.

**KOT header must show:** order no · table + area (or TAKEAWAY / CAR / DELIVERY) · ticket label · waiter name · time · KOT seq.

### 6.2 Order types
| Type | Captures |
|---|---|
| dine_in | area → table; multiple concurrent orders per table allowed |
| takeaway | optional customer name |
| car | **vehicle_no**, optional bay/slot no |
| delivery | phone → customer lookup → name + address |

> **Update 2026-10-04 (2):** All three non-dine-in types now take an optional phone and name (delivery still needs phone and address), and the counter can ask any order for name and phone at settle. Customers are unique by phone (digits only); `orders.customer_name` (migration `0009`) keeps the name as given on that order. Customer lookup is built; the CRM screen comes later.

### 6.3 Invoice lifecycle
```
open ──KOT sent──> open ──bill printed──> billed ──settle──> settled (locked)
                                             │
                                             └── cancelled → VOID record retained
```
- `invoice_no` allocated on **first bill print**, from PC or tablet, inside a transaction.
- Items added after that keep the **same invoice number**; totals recalculate; reprint shows the new total.
- Reprints print `REVISED` / `REPRINT #n` in the header and increment `reprint_count`.
- **Settlement locks the order.** Further items = new order + new invoice number.
- **One customer document: the bill *is* the tax invoice.** From its first print, on the tablet or at the counter, it carries the invoice number, TRN, Net and VAT lines, titled `TAX INVOICE`. Settlement does **not** print a second slip, except in two cases:
  - **No bill was printed** (a takeaway settled straight away): settlement prints it once, with the payments listed.
  - **Lines or the discount changed since the last print**: settlement prints it as `REVISED`, so the customer's paper matches what they paid.
  - Otherwise a cash payment only pops the drawer (a `drawer` print job: ESC p, no paper) and a card payment prints nothing.
- **Reprint after settlement** goes through the same Print Bill action: `REPRINT #n` with payments listed. It never changes the order's settling counter.
- Counter selection: **counter PC uses its own fixed counter, never prompts.** **Tablet shows a selector preselected to `default_counter_id`**, changeable, and the change becomes the new default.

### 6.4 Payments
`payments` is a child table — many rows per order. AED 100 cash + AED 200 on the SBI machine = one order, two rows. Order settles when `sum(payments) >= total`. Day-wise merchant totals are a `GROUP BY payment_mode_id`.

**Every payment row records the settling `counter_id`, `shift_id` and `created_by` (the cashier).** This is what the Z-report counts. On settlement the order's own `counter_id` and `shift_id` are overwritten with the settling counter's; the bill-print counter is not kept.

**No payment without an open shift.** The hub refuses to settle on a counter with no open shift. A payment with no shift would appear on no Z-report: the cash would be in the drawer and missing from the count.

### 6.5 Print queue
- **One serial worker per printer.** Two concurrent sockets to one printer produce shredded output.
- **Socket connect timeout 2–3s.** A dead IP otherwise hangs the queue forever.
- Retry with backoff, ~5 attempts, then fail and raise a visible alert on the cashier PC with a Retry button.
- Health check every 30s (TCP ping :9100) → green/red dot per printer in admin.
- **Test Print button** next to every printer. Non-negotiable for on-site setup.

### 6.6 Employee identity on the tablet — no login

The tablet has **no login screen, no session, no lock.** Paired device boots straight to Home. Instead, an employee picker sheet appears at the moment a record is created:

| Action | Picker? |
|---|---|
| Browsing menu, building the cart | no |
| **Send to Kitchen** | **yes** |
| **Save without KOT** | **yes** |
| **Print Bill** | **yes** |

- Sheet title: *"Who is taking this order?"* → grid of active waiters → one tap → the action fires immediately, no confirm step.
- **No pre-selection.** Never remember and highlight the last person — that is how every order ends up logged as one waiter. One deliberate tap, every time.
- Success toast names them: `KOT sent · Rahul`. A mis-tap is caught in the second it happens.
- The cart belongs to the **tablet**, not to an employee. Whoever picks it up continues the in-progress order — which matches physical reality on a shared device.

**This is identification, not authentication.** Anyone can tap "Rahul". That is acceptable because the tablet cannot take money, cannot discount, cannot settle, and **cannot void** — the blast radius is limited to placing an order inside the restaurant.

> **Dormant seam:** `settings.require_pin_on_action`. When flipped on, the picker demands the employee's 4-digit PIN after the tap. **Do not build the UI for this in MVP** — just make sure the picker returns through a single function that can gain the PIN step later without touching call sites.

### 6.7 Voids

- **Tablet: no voiding at all.** The waiter walks to the counter. This removes the order-food-then-void theft vector, keeps the accountable person (the logged-in cashier) in the loop, and drops a screen and a permission from the MVP.
- **Counter PC only.** Voiding a *sent* line triggers a `*** CANCELLED ***` ticket to that line's kitchen, requires a preset reason, and writes to `audit_log`.

### 6.8 Save without KOT

For an order that was already taken verbally and served — keying it purely so it can be billed. Pressing Send to Kitchen here would make the kitchen **cook it twice**.

The review screen offers two actions:

```
[  Send to Kitchen  (primary)  ]  [  Save without KOT  (secondary)  ]
```

- Lines get `status = 'sent'` **and** `kot_suppressed = true`
- **No `kot_tickets` row and no `print_jobs` row** — nothing reaches the kitchen
- The bill (tax invoice) prints completely normally. Only the kitchen ticket is skipped

Three guards:

1. **Permission-gated** — `employees.can_save_without_kot`. Default **on for admin, off for waiter.** Enable for waiters only if the client asks.
2. **Always written to `audit_log`** — who, which order, which lines.
3. **Counted on the Z-report.** If the owner sees 30 a night, his floor process is broken and he will want to know.

**Per-send, not per-order.** A table with two items already served and three new ones works naturally: key the first two → Save without KOT, key the next three → Send to Kitchen. Same order, correct kitchen behaviour, no workaround.

---

## 7. Tax, currency & calculation

One install = one country, one currency. **No currency conversion.**

```
settings:
  country_code        AE
  currency_code       AED
  currency_display    "AED"      ← text printed on receipts
  currency_decimals   2          ← 3 for KWD / BHD / OMR
  tax_name            "VAT"
  tax_rate            5.00
  tax_number_label    "TRN"
  tax_number_value    100xxxxxxxxxxx
  price_includes_tax  true
  service_charge_pct  0
  invoice_prefix      "INV-"
  rounding            bill_level
  default_kitchen_id  <uuid>
  require_pin_on_action  false   ← dormant seam, see §6.6
```

Nothing in the codebase hardcodes `5%` or `AED`.

### Calculation
```
inclusive:  line_gross = qty × price
            → discount → net = gross / (1 + rate) → vat = gross − net

exclusive:  line_net = qty × price
            → discount → vat = net × rate → gross = net + vat
```
Discount applies **before** tax. Rounding at bill level, to the minor unit. This module gets unit tests — it is where a bug costs you the client.

### Warnings
- ⚠️ **Never print `₹` on a thermal printer.** Most ESC/POS codepages lack it. Use `INR` / `Rs.` — that is why `currency_display` is separate from `currency_code`.
- ⚠️ **India is not a config change.** GST needs CGST/SGST split, HSN codes per item, multiple slabs, and e-invoicing above the turnover threshold. The settings table keeps the seam open — do not claim India support until the GST module exists.
- ⚠️ **UAE e-invoicing (Peppol PINT AE)** is being phased in and may already apply to some taxpayer categories. **Verify the current phase and thresholds with a tax consultant before promising anything.** Put an `einvoice` adapter seam in the invoice module now, as a no-op.

---

## 8. Counter closing (Z-report)

The screen the owner judges you on.

```
Counter 1 · Shift #42 · 10 Sep 2026 · Cashier: Rahul
──────────────────────────────────────────────
Opening float                          500.00

SALES BY PAYMENT MODE
  Cash                                2,340.00
  SBI Card              (18 txns)     4,120.00
  Canara Card            (7 txns)     1,890.00
  ─────────────────────────────────   8,350.00

CASH RECONCILIATION
  Opening float                         500.00
  + Cash sales                        2,340.00
  − Expenses from drawer                180.00
  = Expected in drawer                2,660.00
  Counted                             2,650.00
  VARIANCE                             −10.00

SALES BY ORDER TYPE
  Dine-in 4,200 · Takeaway 1,850 · Car 900 · Delivery 1,400

Discounts 210.00 (6)   Voids 145.00 (3)   Saved without KOT: 3
VAT collected 397.62
Invoice range  INV-1042 → INV-1108
Top employees  Rahul 3,200 · Anees 2,850
```

- Expenses paid from the cash drawer **must** reduce expected cash, or the variance is wrong every night.
- Invoice range on the Z-report — auditors ask for exactly this, and it is one query.
- Employee figures group by **`waiter_id`**, not `created_by` — otherwise every order the cashier keyed on a waiter's behalf credits the cashier.

---

## 9. Backup — the biggest risk of local-only

No cloud means **one hard drive holds the entire business.** If that PC dies, the restaurant loses every record and you lose your reputation.

Non-negotiable for MVP:
- On every shift close, `VACUUM INTO` a timestamped SQLite snapshot
- Keep 30 days locally
- Copy to USB drive or a synced folder if one is present
- Show last-backup timestamp on the dashboard

~30 lines of code. Skipping it is the single most likely way this goes wrong.

> **Update 2026-10-04 (3):** built. A `VACUUM INTO` snapshot is taken at every
> shift close, **once a day** if no shift was closed, on **Backup now**, and
> before a data clear. Files older than **30 days** are deleted after each backup,
> but the newest is always kept (a shop closed for a month still has one). The
> folder is chosen in Settings → Backup, so a USB stick or second drive works;
> there is no automatic copy to a second place yet. The Dashboard shows the last
> backup, and warns when it is over a day old or failed.

---

## 10. Licensing / trial — built

- **No automatic trial.** A fresh install is *not licensed*: new orders and new shifts are blocked until the superadmin grants a trial or a key is activated.
- **First run:** the cashier UI opens on *First-time setup* — choose the superadmin password, add the first admin with a starting PIN, then grant the trial. The admin changes the starting PIN after signing in.
- **Trial** = granted by the superadmin in **minutes, hours or days** (minutes and hours are for testing expiry). It runs from the moment it is granted and replaces any earlier trial; at most 366 days. *End trial now* is there for testing.
- **Paid licence** = a key signed by the vendor (Ed25519), bound to the installation's **install id**, shown on the counter PC under Licence. Format `POS1.<payload>.<signature>`.
- The install id is stored in the **database, not derived from hardware**. Restoring a shift-close backup onto a replacement PC keeps the licence — a dead PC must not lock a restaurant out.
- Warn from **7 days** before expiry, on the counter and on tablets.
- **On expiry: no new orders, no new shifts.** Adding a round to an already-open order, billing, settling, closing the shift and reports all keep working — **never hard-lock mid-service.**
- Because settling needs an open shift, **an expired install may still open a shift while any order is unsettled** (`open` or `billed`). Once nothing is left to settle, new shifts are blocked. `GET /api/shifts/current` returns `canOpen`, and the cashier UI only shows the open-counter step when it is true.
- Setting the PC clock back does **not** extend a licence: expiry is measured from the latest time the install has ever seen.
- If a paid key and a trial both exist, whichever ends later counts — a trial can bridge a lapsed key until the renewal arrives.
- Vendor tooling: `tools/licence-generator.html` (open in a browser — minutes/hours/days, no terminal) and `tools/licence.mjs` (`keygen`, `sign`, `inspect`). The private key never leaves the vendor's machine.

### Device pairing — built

- Only a **paired tablet** can place orders. Without pairing, any device on the shop wifi could send tickets to the kitchen.
- Counter PC → Devices → **Pair a tablet** shows the hub address and a **6-digit code** (single use, expires in 10 minutes, 5 wrong tries locks that caller out for 60 s).
- The tablet exchanges the code for a long-lived token, stored **hashed** on the hub.
- A paired tablet is limited to order-taking routes. Settle, void, discount, masters, reports, licence and device management are **counter-only**.
- **Unpair** takes effect on the tablet's next request; it returns to the pairing screen and keeps any orders it had queued.
- The admin UI is served by the hub over loopback and is **not reachable from the shop wifi**.
---

## 11. Development & delivery on macOS

Develop 100% on macOS. Windows enters only at packaging and final verification.

| Task | How |
|---|---|
| Daily dev | `pnpm dev:server` + `pnpm dev:admin` — Electron untouched most days |
| KOT routing test | 3× `tools/fake-printer.js` on ports 9100/9101/9102 |
| Byte-level print test | One real LAN thermal printer on your desk (~AED 250–400) — **buy week 1** |
| Tablet test | Real Android tablet on same wifi → Mac's LAN IP (`ipconfig getifaddr en0`) |
| Windows build | **GitHub Actions on `windows-latest`** — never cross-build from Mac (`better-sqlite3` is native) |
| Final verification | **Cheap Windows mini-PC (~AED 400)** — also the box you bundle and sell |

### Mac ↔ Windows risk list
| Risk | Handling |
|---|---|
| `better-sqlite3` native build | `electron-builder` + CI on `windows-latest`. Never hand-compile. |
| DB file location | `app.getPath('userData')`. Never hardcode. |
| Paths | Always `path.join()`. Never string concatenation. |
| **Windows Firewall prompt** on first run | Hub opens a port — add a firewall rule in the installer, document for support. |
| Auto-start on boot | `app.setLoginItemSettings()` — test on the mini-PC. |
| Cash drawer kick | ESC/POS through the printer — platform-neutral, no risk. |

### Week-1 de-risking (before any CRUD screens)
1. Print a **real receipt** from Node on macOS to a real LAN printer.
2. Package a **hello-world Electron + SQLite `.exe`** and run it on Windows.

If both work by day 3, everything after is business logic — and business logic never surprises you.

---

## 12. Build order

| Week | Deliverable |
|---|---|
| **1** | Printer spike + Windows packaging spike. Then schema, hub server, PIN auth, item/category/kitchen/printer masters |
| **2** | Expo order app: pairing, PIN login, area/table grid, menu, cart, modifiers, order types, send to kitchen |
| **3** | KOT routing + add-ons + cancel tickets, cashier billing screen, discounts, multi-tender payments, invoice |
| **4** | Reports, expenses, shift open/close + Z-report, backup, printer health panel, polish |

### Demo moment that closes the deal
Unplug the router mid-service and keep taking orders. Nothing else buildable in a month is as persuasive.

---

## 13. Open items

- [ ] Product/brand name
- [ ] `price_includes_tax` — assumed **true** (UAE consumer-facing convention)
- [ ] `service_charge_pct` — assumed **0**
- [ ] Printer makes/models at the client site
- [ ] Confirm bay/slot number needed for car orders
- [ ] Confirm employee sales should credit the order owner rather than splitting add-on rounds per line
- [ ] Decide how the sideloaded APK gets updated on site — manual reinstall, or the hub serving the APK over LAN with an in-app update prompt
- [ ] Verify current UAE e-invoicing phase with a tax consultant
