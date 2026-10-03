# Stitch Prompts

Copy-paste prompts for generating screen designs in Google Stitch.

## How to use

1. Paste the **Theme Preamble** (§0) first — it sets colours, type and density.
2. Then paste **one screen prompt**. One screen per generation; combined prompts produce mush.
3. Generate 2–3 variants, keep the best, then refine with short follow-ups: *"make the cart panel wider"*, *"increase tile height to 64px"*.
4. Content in these prompts is deliberately concrete (real item names, AED amounts). **Do not replace it with placeholders** — Stitch lays out real strings far better than `Lorem ipsum`.

Order to generate: **W06 → W03 → W-EMP → A03 → A04 → A19 → A10** — those seven carry the demo.

---

## §0 · Theme Preamble

```
Design system for a restaurant POS application.

Typography: Inter. Screen titles 24px/600. Body 15px/400.
All monetary values use tabular numerals, 600 weight, right-aligned.
Large totals 28px/700.

Brand: primary indigo #4F46E5, hover #4338CA, white text on primary.
Semantic colours: success green #16A34A, warning amber #F59E0B,
danger red #DC2626, info blue #0EA5E9.
Order type accents: dine-in indigo #4F46E5, takeaway amber #F59E0B,
car cyan #06B6D4, delivery violet #8B5CF6 — used as left borders and
small chips only, never as full tile fills.

Shape: inputs 6px radius, buttons 10px, cards and tiles 12px, modals 16px.
Use 1px borders instead of drop shadows; shadows only on modals and dropdowns.
Spacing on a 4px scale.

Every status is shown with a text label or number as well as colour —
never colour alone. No hover-only controls. No small close icons.
```

---

# A. Admin PC — light theme

Append to every admin prompt:
```
Desktop app window, 1366x768, light theme.
Background #F1F5F9, cards #FFFFFF, borders #E2E8F0,
text #0F172A, muted text #64748B. Rows 44px tall. Buttons 40px tall.
```

## A03 · Orders / Billing — generate first

```
A cashier billing screen for a restaurant POS desktop app.

Top header bar: business name "Al Manzil Restaurant" on the left. On the right,
a printer health strip reading "Arabic ●  Chinese ●  Juice ●  Counter 1 ●" where the
first three dots are green and Chinese is red, then a user chip "Rahul · Cashier".

Two-column body.

LEFT COLUMN, 380px wide, white card: heading "Open Orders". Below it a search
field "Search table, invoice or phone". Below that a row of filter chips:
All, Dine-in, Takeaway, Car, Delivery. Then a scrollable list of order cards.
Each card has a coloured left border by order type and shows: table name in bold
("A5"), a small type chip, the waiter name, elapsed time ("18 min"), and the
total right-aligned in tabular numerals ("AED 245.00"). One card is selected with
an indigo tint background #EEF2FF. Cards read:
  A5 · Dine-in · Rahul · 18 min · AED 245.00   (selected)
  A5 · Dine-in · Anees · 6 min · AED 88.00
  Car · KA-05-MH-1234 · Rahul · 3 min · AED 62.00
  Delivery · Fatima · 22 min · AED 310.00

RIGHT COLUMN, fills remaining width, white card.
Header row: "Order #1042" large, an indigo "Dine-in" chip, "Table A5 · Ground Floor",
a grey ticket label chip "Blue shirt", "Invoice INV-1042", and a small bordered
dropdown control labelled "Waiter" showing "Rahul" with a chevron.
Beneath the header an amber inline warning bar: "Items added after bill was printed —
next print will be marked REVISED".

Then a line items table with columns Item, Qty, Price, Amount. Rows:
  Periperi Alfaham        1   85.00   85.00
  Chicken Noodles         2   38.00   76.00
  Apple Juice             1   22.00   22.00
  Mint Lemonade           1   18.00   18.00
Each row has a small grey void icon button at the end. Qty and money columns
right-aligned, tabular numerals.

Below the table, a right-aligned totals block:
  Subtotal      AED 201.00
  Discount      − AED 10.00   (in red)
  VAT 5%        AED  9.10
  TOTAL         AED 245.00    (28px, bold, indigo)

Bottom action bar pinned to the card: a ghost "Add Item" button and a ghost
"Discount" button on the left; on the right a bordered "Print Bill" button and a
filled indigo "Settle" button, plus a red-outlined "Void Order" button.
```

## A04 · Settle payment modal

```
A payment settlement modal over a dimmed restaurant POS screen. Modal 640px wide,
white, 16px radius, soft shadow.

Title "Settle Order #1042". Beneath it, right-aligned, "Total Due" label with
"AED 245.00" in 28px bold indigo.

A row of payment method buttons, each 56px tall, bordered, with the method name and
a small type label under it:
  Cash | SBI Card | Canara Card | Bank Transfer
"SBI Card" is selected with an indigo border and #EEF2FF background.

Below, an amount input showing "150.00" with a large right-aligned tabular value,
and a row of quick-amount chips: "Exact", "50", "100", "200", "500".
Under the amount, a text field labelled "Approval / Ref No" with placeholder "Last 4 digits".

Then an "Added Payments" list showing rows with a small delete icon:
  Cash          AED  95.00
  SBI Card      AED 150.00

Below that, a summary line: "Balance Due  AED 0.00" in green, bold.

Footer: a ghost "Cancel" button on the left, a filled indigo "Settle"
button on the right, 44px tall.
```

## A10 · Printers

```
A printer management screen for a restaurant POS desktop app.

Page title "Printers" with a filled indigo "Add Printer" button on the right.

A white card containing a table with columns:
Name, IP Address, Port, Paper Width, Status, Pending Jobs, Actions.

Rows:
  Arabic Kitchen    192.168.1.15   9100   80mm   ● Online   0   [Test Print] [Edit]
  Chinese Kitchen   192.168.1.20   9100   80mm   ● Offline  3   [Test Print] [Edit]
  Juice Corner      192.168.1.21   9100   58mm   ● Online   0   [Test Print] [Edit]
  Counter 1         192.168.1.30   9100   80mm   ● Online   0   [Test Print] [Edit]

Status is a pill: green "Online", red "Offline". The Chinese Kitchen row has a very
light red background tint and its pending jobs count "3" shown as a red badge.
"Test Print" is a bordered button, "Edit" is a ghost button.

Above the table, a red alert banner: "Chinese Kitchen printer is unreachable.
3 tickets are queued." with a bordered "Retry All" button on its right.
```

## A02 · Dashboard

```
A dashboard home screen for a restaurant POS desktop app.

Page title "Today · 10 September 2026".

A row of four stat cards, white, equal width. Each has a small uppercase muted label,
a large tabular value, and a small muted sub-line:
  TODAY'S SALES / AED 8,350.00 / 67 invoices
  ORDERS / 74 / 7 still open
  CASH IN DRAWER / AED 2,660.00 / expected
  AVG TICKET / AED 124.63 / +8% vs yesterday

Below, two cards side by side.

Left card "Sales by Order Type": four horizontal bars with labels and values,
each bar in its type accent colour:
  Dine-in AED 4,200 (indigo), Takeaway AED 1,850 (amber),
  Car AED 900 (cyan), Delivery AED 1,400 (violet).

Right card "Open Orders": a compact list with columns Table, Waiter, Time, Total, Status.
  A5   Rahul   18 min   AED 245.00   [Bill Printed]  (blue pill)
  A5   Anees    6 min   AED  88.00   [Open]          (amber pill)
  T2   Rahul   41 min   AED 512.00   [Open]          (amber pill)
  Car  Rahul    3 min   AED  62.00   [Open]          (amber pill)

At the bottom, a thin full-width strip: on the left the printer health dots
"Arabic ● Chinese ● Juice ● Counter 1 ●", on the right muted text
"Last backup: today 14:02".
```

## A19 · Shift close (Z-report)

```
A shift closing screen for a restaurant POS desktop app.

Header: "Close Shift" title, and a subtitle line
"Counter 1 · Shift #42 · 10 September 2026 · Cashier: Rahul".

Two columns.

LEFT, white card "Sales by Payment Mode": a table with right-aligned tabular amounts.
  Cash                        AED 2,340.00
  SBI Card        18 txns     AED 4,120.00
  Canara Card      7 txns     AED 1,890.00
  ──────────────────────────────────────
  Total                       AED 8,350.00   (bold)

Beneath it in the same column, a card "Sales by Order Type" with four small stat rows:
Dine-in AED 4,200 · Takeaway AED 1,850 · Car AED 900 · Delivery AED 1,400,
each with its accent colour as a small left bar.

RIGHT, white card "Cash Reconciliation": a stacked calculation, labels left,
tabular amounts right:
  Opening float               AED   500.00
  + Cash sales                AED 2,340.00
  − Expenses from drawer      AED   180.00
  ─────────────────────────────────────────
  Expected in drawer          AED 2,660.00   (bold)
Then a prominent input field labelled "Counted Cash" containing "2,650.00",
large and right-aligned.
Then a highlighted variance row in a light red box:
  VARIANCE                    − AED 10.00    (red, bold, 24px)

Below the two columns, a full-width white card with five small summary blocks in a row,
each with a 13px uppercase muted label above a larger value:
  DISCOUNTS AED 210.00 (6) · VOIDS AED 145.00 (3) · SAVED WITHOUT KOT 3 ·
  VAT COLLECTED AED 397.62 · INVOICES INV-1042 → INV-1108
The "SAVED WITHOUT KOT" block has an amber value.

Beneath that, a full-width white card "Sales by Waiter" with a small table:
  Rahul    28 orders    AED 3,200.00
  Anees    24 orders    AED 2,850.00
  Suhail   15 orders    AED 2,300.00

Footer action bar: bordered "Print Z-Report" on the left,
filled indigo "Close Shift" on the right.
```

## A07 · Categories

```
A category management screen for a restaurant POS desktop app.

Page title "Categories", filled indigo "Add Category" button on the right.

White card with a table, columns: Category, Kitchen, Printer, Items, Sort, Active.
Rows:
  Alfaham    Arabic Kitchen    192.168.1.15   12   1   [toggle on]
  Noodles    Chinese Kitchen   192.168.1.20    8   2   [toggle on]
  Shakes     Juice Corner      192.168.1.21   15   3   [toggle on]
  Desserts   — not set —       default kitchen 6   4   [toggle on]

The Kitchen cell is a chip. The Printer cell is muted monospace text.
The "Desserts" row shows its kitchen cell as an amber chip reading "Default Kitchen"
with a small warning icon.

Right side of the screen: a slide-over edit panel, 420px wide, white, titled
"Edit Category". Fields: text input "Name" with value "Alfaham";
a select "Kitchen" with value "Arabic Kitchen" and helper text under it reading
"KOT for these items prints to 192.168.1.15"; a number input "Sort order" = 1;
a toggle "Active" = on. Footer: ghost "Cancel", filled indigo "Save Category".
```

## A22 · Device pairing

```
A device pairing screen for a restaurant POS desktop app.

Centred white card, 560px wide. Title "Pair a Waiter Tablet".
Step text: "Open the app on the tablet and scan this code."

A large QR code, 280x280px, centred, with a thin border.

Below the QR, a muted monospace fallback line in a light grey box:
"Or enter manually — IP 192.168.1.10  ·  Port 4000  ·  Code 4821"

Below the card, a section titled "Paired Devices" with a table:
  Tablet 1   Waiter tablet   Counter 1   Last seen: just now      [Unpair]
  Tablet 2   Waiter tablet   Counter 1   Last seen: 2 hours ago   [Unpair]
  Front Desk Counter PC      Counter 1   THIS DEVICE              (indigo chip, no unpair)
```

---

# B. Waiter app — dark theme, Android

Append to every waiter prompt:
```
Android tablet app, 1280x800 landscape, dark theme.
Background #0B1220, surfaces #151E31, elevated surfaces #1E293B,
borders #2D3B54, text #F1F5F9, muted text #94A3B8.
All tappable elements at least 56px tall. Body text 17px/500.
No hover states. Buttons are full width or half width, never small inline links.
```

### Waiter screen index — 16 prompts, 14 screens

Already generated: **W03 · W06 · W-EMP**

Remaining generation order — capture flow first, then the order lifecycle, then support screens:

`W08 → W04 → W09 → W10 → W05a → W05b → W05c → W07a → W07b → W13 → W11 → W01 → W02 → W12`


## W06 · Menu & cart — generate first

```
An order-taking screen for a restaurant waiter's Android tablet, landscape.

Top bar: back arrow, "Table A5 · Ground Floor" as the title, a small grey chip
"Blue shirt", an indigo "Dine-in" chip, and on the right a green dot with
"Connected". There is no user avatar and no logout control — this app has no login.

Three columns.

LEFT RAIL, 220px: a vertical list of category buttons, 56px tall each, rounded 12px.
Items: All, Alfaham, Noodles, Shakes, Starters, Desserts, Beverages.
"Alfaham" is selected with an indigo #4F46E5 fill and white text; the rest are
#1E293B with light text.

CENTRE, flexible: a search field "Search items" at the top, then a 4-column grid of
item tiles. Each tile is 12px radius, #1E293B, at least 96px tall, showing the item
name in 17px/600 and the price beneath in indigo tabular numerals. Tiles:
  Periperi Alfaham AED 85.00 · Kanthari Alfaham AED 90.00 ·
  Alfaham Full AED 160.00 · Alfaham Quarter AED 45.00 ·
  Garlic Alfaham AED 88.00 · Spicy Alfaham AED 92.00 ·
  Alfaham Platter AED 175.00 · Boneless Alfaham AED 98.00
One tile, "Alfaham Full", is dimmed to 40% opacity with a small red
"Unavailable" pill across it.

RIGHT PANEL, 320px, #151E31, with a left border:
Heading "Current Order" and a muted line "4 items".
A divider labelled "SENT TO KITCHEN" in 12px uppercase muted text, then two dimmed
rows with a small green check:
  Periperi Alfaham   1   AED 85.00
  Apple Juice        1   AED 22.00
Then a divider labelled "NEW" in 12px uppercase indigo text, then two bright rows,
each with a 56x56px minus button, the quantity, a 56x56px plus button, the item
name, a small note icon, and the amount right-aligned:
  Chicken Noodles    2   AED 76.00
  Mint Lemonade      1   AED 18.00

Pinned at the bottom of the right panel: a totals line "Total  AED 201.00" with the
amount in 28px bold, and beneath it a full-width 64px indigo button
"Send to Kitchen · 3 new items".
```

## W03 · Home — table grid

```
A home screen for a restaurant waiter's Android tablet, landscape, dark theme.
There is no login on this app — the screen opens directly to this.

Top bar: "Al Manzil Restaurant" on the left, and a green dot with "Connected"
on the right. No user avatar and no logout control.

Below the header, a segmented control with two segments, 56px tall:
"Tables" (selected, indigo fill, white text) and "Open Orders" with a small
indigo circular badge containing "3".

An amber warning banner beneath it, full width, 12px radius:
"Unsent order for Table A5 · 3 items" with a bordered "Resume" button and a
ghost "Discard" button on its right.

A row of area tabs: "Ground Floor" (selected, indigo underline, white text),
"Family Section", "Terrace", "AC Hall" (muted).

A 6-column grid of table tiles, each 12px radius, at least 120px tall, showing the
table name in 24px bold at the top left, a status label at the bottom, and the seat
count as a small muted number in the top right.

Tile states:
- Free tiles: #1E293B background, a thin green #16A34A left border,
  bottom label "Free" in green. Tables A1, A2, A6, A8, A9, A10, A11, A12.
- Occupied tiles: amber #F59E0B left border, bottom shows "24 min" and
  "AED 512.00" in tabular numerals. Tables A3, T2.
- Bill printed tile: blue #0EA5E9 left border, bottom label "Bill Printed" in blue
  and "AED 245.00". Table A7.
- Table A5 is occupied AND has a circular indigo badge in the top-right corner
  containing the number "2", with the bottom label "2 orders · AED 333.00".

Pinned at the bottom, a bar with three large 64px buttons side by side, each with an
icon and label, outlined in their accent colour: "Takeaway" amber #F59E0B,
"Car" cyan #06B6D4, "Delivery" violet #8B5CF6.
There is deliberately NO "Dine-in" button — tapping a table is dine-in.
```

## W04 · Occupied table sheet

```
A bottom sheet over a dark restaurant POS tablet table grid.

The sheet is #151E31, rounded 16px at the top, covering the lower 60% of the screen,
with a small drag handle centred at the top.

Title "Table A5 · Ground Floor" with a muted subtitle "2 open orders".

Two order cards stacked, each #1E293B, 12px radius, at least 88px tall, with an
indigo left border:
  Card 1: "Order #1042" bold, grey chip "Blue shirt", muted line
          "Rahul · 18 min · 4 items", right side "AED 245.00" in 20px tabular bold
          and a blue "Bill Printed" pill.
  Card 2: "Order #1047" bold, grey chip "Family", muted line
          "Anees · 6 min · 2 items", right side "AED 88.00" in 20px tabular bold
          and an amber "Open" pill.

Below the cards, a full-width 64px indigo button with a plus icon reading
"New Order on this Table".
```

## W08 · Order review

```
An order confirmation screen for a restaurant waiter's Android tablet, dark theme.

Top bar: back arrow, title "Review Order", "Table A5 · Ground Floor" as subtitle.

An amber banner near the top: "ADD-ON — these items will print as KOT #2".

Body: items grouped into three cards, each with a coloured header strip showing the
kitchen name in 13px uppercase and the printer IP in muted monospace on the right:

  Card "ARABIC KITCHEN — 192.168.1.15"
      1 × Periperi Alfaham            AED 85.00
        note: "extra spicy"  (small italic muted line under the item)

  Card "CHINESE KITCHEN — 192.168.1.20"
      1 × Chicken Noodles             AED 38.00

  Card "JUICE CORNER — 192.168.1.21"
      1 × Apple Juice                 AED 22.00

Each card is #1E293B with 12px radius. Item names 17px/500, amounts right-aligned
tabular.

A muted helper line under the cards: "3 separate tickets will print."

Pinned bottom bar: total "AED 145.00" in 28px bold on the left.
Beneath it, two buttons side by side on one row, both 64px tall:
a filled indigo #4F46E5 button "Send to Kitchen" taking two thirds of the width,
and a bordered muted button "Save without KOT" taking one third. The second button
is deliberately much weaker visually than the first.
```

## W05a · Car capture

```
A customer detail capture screen for a restaurant waiter's Android tablet, dark theme.

Top bar: back arrow, title "Car Order".

A centred form card, 640px wide, #151E31, 16px radius.

A cyan #06B6D4 chip at the top reading "CAR".

Fields, each with a 13px uppercase muted label above and a 64px tall input below:
  VEHICLE NUMBER — a large 24px uppercase input containing "KA 05 MH 1234"
  BAY / SLOT NUMBER (optional) — input containing "Bay 3"
  CUSTOMER NAME (optional) — empty input with placeholder "Optional"

Footer inside the card: half-width bordered "Cancel" button and half-width filled
indigo "Continue to Menu" button, both 64px tall.
```

## W10 · Print bill modal

```
A print bill modal over a dark restaurant POS tablet screen.

Modal 560px wide, #151E31, 16px radius, centred, with a dimmed backdrop.

Title "Print Bill" and subtitle "Order #1042 · Table A5".

An amber warning bar: "This bill has been printed once. It will print as REPRINT #2."

A totals block, labels left in muted text, amounts right in tabular numerals:
  Subtotal            AED 201.00
  Discount          − AED  10.00   (red)
  VAT 5%              AED   9.10
  TOTAL               AED 245.00   (28px bold, indigo, with a divider above)

Below, a field labelled "PRINT AT COUNTER" in 13px uppercase muted text, containing
two selectable option buttons side by side, 64px tall:
  "Counter 1" — selected, indigo border with a dark indigo tint fill and a check icon
  "Counter 2" — plain #1E293B
Under them a small muted helper line: "Your default. Change it and it will be remembered."

A muted note: "Payment is collected at the counter."

Footer: half-width bordered "Cancel", half-width filled indigo "Print Bill", 64px tall.
```

## W-EMP · Employee picker

```
A bottom sheet over a dark restaurant POS tablet order screen, landscape.

The sheet is #151E31, rounded 16px at the top, covering the lower half of the
screen, with a small drag handle centred at the top. The screen behind it is dimmed.

Title in 24px: "Who is taking this order?"
A muted 15px subtitle: "3 new items · AED 145.00"

A 4-column grid of employee tiles. Each tile is at least 120x120px, #1E293B,
12px radius, containing a 56px indigo #4F46E5 circular avatar with white initials,
and the employee name below in 17px/600. Tiles:
  RA "Rahul" · AN "Anees" · SU "Suhail" · FA "Fatima"

None of the tiles are selected or highlighted — they are all in the identical
resting state.

At the bottom of the sheet, a full-width bordered "Cancel" button, 56px tall.
```

## W05b · Delivery capture

```
A delivery customer capture screen for a restaurant waiter's Android tablet,
landscape, dark theme.

Top bar: back arrow, title "Delivery Order".

A centred form card, 720px wide, #151E31, 16px radius.
A violet #8B5CF6 chip at the top reading "DELIVERY".

First field, labelled "PHONE NUMBER" in 13px uppercase muted text: a 64px input
containing "+971 50 442 8871" with a small magnifier icon button at its right end.

Below it, a green-tinted confirmation strip, 12px radius, with a check icon reading
"Existing customer — Fatima Al Suwaidi · 7 previous orders".

Then a field labelled "CUSTOMER NAME": a 64px input containing "Fatima Al Suwaidi".

Then a field labelled "DELIVERY ADDRESS" with two saved address options stacked as
selectable cards, each at least 88px tall, 12px radius:
  Card 1 — selected, indigo border with a dark indigo tint fill and a check icon:
    "Home" in 17px/600, then muted 15px "Flat 1204, Al Noor Tower, Al Barsha 1,
    near Lulu Hypermarket"
  Card 2 — plain #1E293B:
    "Office" in 17px/600, then muted 15px "Office 305, Bay Square Building 6,
    Business Bay"
Below the cards, a bordered full-width 56px button "+ Add New Address".

Then a field labelled "NOTE FOR DRIVER (optional)": a 64px input with placeholder
"Gate code, landmark, etc."

Footer inside the card: half-width bordered "Cancel" and half-width filled indigo
"Continue to Menu", both 64px tall.
```

## W05c · Takeaway capture

```
A takeaway order capture screen for a restaurant waiter's Android tablet,
landscape, dark theme.

Top bar: back arrow, title "Takeaway Order".

A centred form card, 560px wide, #151E31, 16px radius.
An amber #F59E0B chip at the top reading "TAKEAWAY".

One field, labelled "CUSTOMER NAME (OPTIONAL)" in 13px uppercase muted text:
a 64px input with placeholder "Name or nickname to call out".

A muted 15px helper line below it: "Leave blank to use the order number."

Footer inside the card: half-width bordered "Cancel" and half-width filled indigo
"Continue to Menu", both 64px tall.

Keep this screen deliberately sparse — it must be dismissable in one tap.
```

## W07a · Modifier sheet

```
A modifier selection bottom sheet over a dark restaurant POS tablet menu screen.

The sheet is #151E31, rounded 16px at the top, covering the lower 70% of the screen,
with a drag handle centred at the top. The screen behind it is dimmed.

Header row: "Periperi Alfaham" in 24px/600 on the left, "AED 85.00" in 20px tabular
bold indigo on the right.

First group: a 13px uppercase muted label "SPICE LEVEL" with a smaller muted hint
"Choose 1" beside it. Below, three selectable option rows, each 64px tall,
12px radius, #1E293B, showing the option name on the left and the price delta on the
right in muted tabular text:
  Mild        +AED 0.00
  Medium      +AED 0.00      (selected — indigo border, dark indigo tint, check icon)
  Extra Hot   +AED 0.00

Second group: label "ADD-ONS" with hint "Choose up to 3". Three option rows:
  Extra Mayo      +AED 5.00
  Garlic Sauce    +AED 5.00   (selected)
  Pita Bread      +AED 8.00

Third group: label "NOTE" and a 64px text input containing "no onion".

Pinned bottom bar inside the sheet: on the left a quantity control with a 56x56px
minus button, "1" in 24px, and a 56x56px plus button. On the right a filled indigo
64px button "Add to Order · AED 90.00".
```

## W07b · Note-only sheet (plain item, long-press)

```
A note entry bottom sheet over a dark restaurant POS tablet menu screen.

The sheet is #151E31, rounded 16px at the top, covering the lower 45% of the screen,
with a drag handle centred at the top. The screen behind it is dimmed.

Header row: "Apple Juice" in 24px/600 on the left, "AED 22.00" in 20px tabular bold
indigo on the right.

A 13px uppercase muted label "NOTE" and below it a large multi-line text area, at
least 96px tall, 12px radius, #1E293B, containing "no ice, less sugar".

Below the text area, a row of quick-note chips, 48px tall, bordered:
  "No ice"  "No sugar"  "Less sugar"  "Extra cold"

Pinned bottom bar inside the sheet: on the left a quantity control with a 56x56px
minus button, "1" in 24px, and a 56x56px plus button. On the right a filled indigo
64px button "Add to Order · AED 22.00".

There are no modifier groups on this screen — only the note and quantity.
```

## W09 · Open order

```
An open order detail screen for a restaurant waiter's Android tablet, landscape,
dark theme.

Top bar: back arrow, title "Order #1042", a green dot with "Connected" on the right.

A header card, #151E31, 12px radius, containing on the left: an indigo "Dine-in"
chip, "Table A5 · Ground Floor" in 17px/600, a grey chip "Blue shirt", and a muted
15px line "Opened by Rahul · 18 min ago". On the right, "AED 245.00" in 28px tabular
bold and a blue #0EA5E9 pill "Bill Printed".

Below it, a list of order lines grouped by status.

A 12px uppercase muted divider "SENT TO KITCHEN", then rows, each at least 64px
tall, #1E293B, 12px radius, dimmed slightly, with a small green check at the left,
the quantity, the item name in 17px/500, the amount right-aligned in tabular bold,
and no delete or void control of any kind:
  ✓  1   Periperi Alfaham              AED 85.00
         note: "extra spicy"  (small italic muted line)
  ✓  2   Chicken Noodles               AED 76.00
  ✓  1   Apple Juice                   AED 22.00
  ✓  1   Mint Lemonade                 AED 18.00
         added by Anees  (small muted 12px line)

A muted 13px helper line beneath the list: "To cancel an item, ask the cashier."

Pinned bottom action bar with three buttons, all 64px tall: a bordered "Change Table"
at one quarter width, a bordered "Print Bill" at one quarter width, and a filled
indigo "Add Items" at half width.
```

## W13 · Change table

```
A change-table bottom sheet over a dark restaurant POS tablet order screen.

The sheet is #151E31, rounded 16px at the top, covering the lower 70% of the screen,
with a drag handle centred at the top. The screen behind it is dimmed.

Title "Move Order #1042" with a muted 15px subtitle "Currently at Table A5 ·
Ground Floor".

A row of area tabs: "Ground Floor" (selected, indigo underline), "Family Section",
"Terrace", "AC Hall" (muted).

A 6-column grid of table tiles, each 12px radius, at least 110px tall, showing the
table name in 24px bold and the seat count as a small muted number top right.

Tile states:
- Free tiles: #1E293B with a green #16A34A left border and a bottom label "Free" in
  green. Tables A1, A2, A6, A8, A9, A10, A11, A12.
- The current table A5 is shown with an indigo border, a dark indigo tint fill and a
  bottom label "CURRENT" in indigo.
- Occupied tables A3, A7 and T2 are dimmed to 35% opacity with a bottom label
  "Occupied" and are clearly not tappable.

Pinned at the bottom of the sheet, a full-width bordered "Cancel" button, 56px tall.
```

## W11 · Open orders

```
An open orders list screen for a restaurant waiter's Android tablet, landscape,
dark theme.

Top bar: "Al Manzil Restaurant" on the left, a green dot with "Connected" on the
right. No user avatar and no logout control.

Below the header, a segmented control, 56px tall: "Tables" (muted) and
"Open Orders" (selected, indigo fill, white text) with a small indigo circular badge
containing "6".

A row of filter chips, 48px tall: "All Waiters" (selected, indigo), "Rahul",
"Anees", "Suhail", "Fatima".

A vertical list of order cards, each #151E31, 12px radius, at least 96px tall, with a
coloured left border by order type. Each card shows on the left: the table or type in
17px/600, a small type chip, a grey ticket label chip where present, and a muted 15px
line with the waiter name, elapsed time and item count. On the right: the total in
20px tabular bold and a status pill.

  A5    Dine-in    "Blue shirt"   Rahul · 18 min · 4 items    AED 245.00  [Bill Printed] blue
  A5    Dine-in    "Family"       Anees · 6 min · 2 items     AED  88.00  [Open] amber
  T2    Dine-in                   Rahul · 41 min · 9 items    AED 512.00  [Open] amber
  Car   KA 05 MH 1234             Rahul · 3 min · 2 items     AED  62.00  [Open] amber
  Del   Fatima Al Suwaidi         Suhail · 22 min · 5 items   AED 310.00  [Open] amber
  TA    "Ahmed"                   Anees · 9 min · 1 item      AED  35.00  [Bill Printed] blue

A muted summary line pinned at the bottom: "6 open orders · AED 1,252.00".
```

## W01 · Pairing

```
A device pairing screen for a restaurant waiter's Android tablet, landscape,
dark theme.

No top bar, no back arrow — this is the first-run screen.

Centred content, 720px wide.

At the top, a 48px indigo circular icon with a tablet glyph, then the heading
"Pair this Tablet" in 24px/600, then a muted 17px line
"Scan the QR code shown on the counter PC."

Below, a large camera viewfinder area, 420x420px, 16px radius, showing a dark
neutral grey placeholder with an indigo square scanning frame inset in the centre
and indigo corner brackets.

Beneath the viewfinder, a divider with the muted word "OR" centred.

Then a compact manual entry row: two inputs side by side, both 64px tall, labelled
"HUB IP" containing "192.168.1.10" and "CODE" containing "4821", followed by a
bordered 64px button "Connect".

At the very bottom, muted 13px text: "Ask your manager if you don't have the code."
```

## W02 · Connection error

```
A connection error screen for a restaurant waiter's Android tablet, landscape,
dark theme.

Centred content, 640px wide, no top bar.

A 64px red-tinted circular icon containing a crossed-out wifi glyph.

Heading in 24px/600: "Can't reach the counter"
Below it, muted 17px body text: "The tablet is paired but the counter PC is not
answering."

A dark information card, #1E293B, 12px radius, with three rows of label and value,
values in muted monospace:
  Hub          192.168.1.10:4000
  Wi-Fi        AL-MANZIL-WIFI
  Last synced  4 minutes ago

Below the card, a bulleted checklist in muted 15px text:
  · Check the tablet is on AL-MANZIL-WIFI
  · Check the counter PC is switched on
  · Check the POS app is running on the counter PC

Then a filled indigo 64px full-width button "Retry Connection", and beneath it a
ghost text button "Device Settings".

Do not show a spinner or a blank state — this screen must always be actionable.
```

## W12 · Device settings & diagnostics

```
A device settings and diagnostics screen for a restaurant waiter's Android tablet,
landscape, dark theme. This screen is reached by long-pressing the restaurant name
and is used by support staff, not waiters.

Top bar: back arrow, title "Device Settings".

A centred column, 720px wide, of dark cards, #151E31, 12px radius.

Card 1 "Connection": rows of label on the left and value on the right, values in
muted monospace, with a green dot beside the status:
  Status        ● Connected
  Hub           192.168.1.10:4000
  Wi-Fi         AL-MANZIL-WIFI
  Latency       12 ms
  Last synced   just now
Below the rows, two bordered buttons side by side, 56px tall:
"Test Connection" and "Refresh Menu".

Card 2 "Device": rows of label and value:
  Device name   Tablet 1
  Paired on     3 September 2026
  Default counter  Counter 1
  App version   1.0.0 (build 14)

Card 3, with a red #DC2626 border: heading "Re-pair Device" in 17px/600, muted 15px
body text "This will disconnect the tablet and require a new QR scan from the
counter PC.", and a red-outlined full-width 56px button "Re-pair Device".

At the very bottom, muted 12px centred text: "Support: long-press the restaurant
name to return here."
```

## A01 · Admin login (light theme, desktop)

```
A login screen for a restaurant POS desktop app, 1366x768, light theme.
Background #F1F5F9.

Centred white card, 720px wide, 16px radius, 1px #E2E8F0 border.

At the top, the restaurant name "Al Manzil Restaurant" in 24px/600 #0F172A, and
beneath it a muted 13px line "Counter 1 · 192.168.1.10".

A horizontal row of four employee tiles, each 140x140px, #F8FAFC, 12px radius,
1px border, containing a 56px circular indigo avatar with white initials and the
name below in 15px/500:
  RA "Rahul · Cashier", AN "Anees · Admin", SU "Suhail · Cashier",
  FA "Fatima · Admin".
"Rahul" is selected with an indigo #4F46E5 border and a #EEF2FF fill.

Below, four dots showing PIN entry progress, two filled indigo and two hollow.

Beneath that, a centred 3x4 numeric keypad. Keys are 88x88px, white with a
1px #E2E8F0 border, 10px radius, 28px numerals #0F172A: 1-9, then a blank space,
0, and a backspace icon key.

Under the keypad, a ghost text link "Sign in with password instead".

At the bottom of the card, an amber notice bar with a 12px radius:
"Trial licence expires in 6 days."
```

---

## Refinement follow-ups that work well in Stitch

- `Make all tap targets larger — minimum 64px height.`
- `Increase contrast between the sent and new sections in the cart.`
- `Show the amounts in a monospaced tabular font, right aligned.`
- `Remove the drop shadows and use 1px borders instead.`
- `Add an empty state: no tables in this area, with a button to add one.`
- `Show this at 1024x768 instead.`
- `Remove any selected or highlighted state from the employee tiles — they must all look identical.`
- `Make the secondary button visually much weaker than the primary one.`
