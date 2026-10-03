# Menu Import (CSV)

Load a whole menu (categories and items) from one spreadsheet instead of
typing it in item by item. It is built for the on-site setup day: the owner
sends their menu as Excel, someone saves it as CSV and imports it at the
counter PC.

**Where:** cashier UI → **Setup → Categories** or **Setup → Items** → **Import CSV**.
Counter PC only. A paired tablet gets 403.

---

## 1. Before you import: printers and kitchens

KOT routing runs through this chain:

```
Printer (IP)  ◄──  Kitchen  ◄──  Category  ◄──  Item
```

The CSV names a **kitchen** for each category. It never names a printer: the
kitchen already knows its printer. That means:

1. **Printers** go in first (Setup → Printers): name, IP, port, width. Test print each one.
2. **Kitchens** next (Setup → Kitchens): "Arabic Kitchen" → its printer, "Juice Corner" → its printer.
3. **Set the default kitchen** (Settings). Categories with no kitchen print there.
4. **Then import the menu.**

The import **never creates a kitchen**. A kitchen must have a printer, and a
spreadsheet has no business inventing one. If the sheet names a kitchen that
doesn't exist, the import is blocked until you create it under Setup.

If routing is wrong or skipped, you can still import the menu and set each
category's kitchen afterwards under **Setup → Categories**.

---

## 2. The file

```csv
category,item,price,kitchen
Grills,Chicken Tikka,32.00,Arabic Kitchen
Grills,Mixed Grill,55.00,
Grills,Lamb Chops,62.50,
Juices,Fresh Orange,14.00,Juice Corner
Juices,Lemon Mint,12.00,
Desserts,Kunafa,25.00,
```

**Download template** in the import dialog gives you this layout, filled in
with the hub's real kitchen names so they can be copied exactly.

### Columns

| Column | Required | Also accepted as | Notes |
|---|---|---|---|
| `category` | yes | `category name`, `group` | Created if it doesn't exist. Matched by name, case-insensitive. |
| `item` | yes | `item name`, `name` | Matched by name **within its category**. |
| `price` | yes | `rate`, `amount` | Decimal, e.g. `32.00`. See *Prices* below. |
| `kitchen` | no | `kitchen name`, `kot` | Must be an existing, active kitchen. Case-insensitive. |

- The first line must be the header row. Column order doesn't matter, and
  headers ignore case, spaces, `_` and `-`.
- Extra columns are ignored, so a sheet with a `description` or `notes` column is fine.
- Blank lines are skipped.
- Quoted fields work (`"Rice, Biryani"`). Excel's **CSV UTF-8** format (with
  its byte-order mark) is read correctly.
- At most **2000 rows** per import.

### The kitchen column

- Give the kitchen **once per category**, on any line of that category. The
  other lines can leave it blank (as `Grills` does above).
- Giving the same new category **two different kitchens** is an error. Letting
  the last line win would route a whole category by accident of row order.
- A new category with **no kitchen** prints at the **default kitchen**. If no
  default kitchen is set either, you get a warning: those KOTs would have
  nowhere to print until a kitchen is chosen.
- A category that **already exists keeps its kitchen**. If the sheet says
  something different, you get a warning and nothing changes. Re-routing an
  existing category is done deliberately, under Setup → Categories.

### Prices

- Written in the major unit: `32.00`, `32`, `32.5`, `1,250.00` (thousands commas are removed).
- No more decimal places than the currency has (2 for AED). `30.005` is
  **rejected, not rounded**: the menu must not carry a price nobody typed.
- The price means the same as in the item form. With `priceIncludesTax` on
  (the default for Dubai) it's the price the customer pays, VAT included.

---

## 3. Check, then import

Choosing a file only **checks** it; nothing is written yet. The dialog shows:

| Section | What it means |
|---|---|
| **Problems** (red) | Blocking. Nothing is imported while any exist. Each one names the **spreadsheet line**. Fix the sheet and choose it again. |
| **Worth knowing** (amber) | Not blocking. Read before importing. |
| **KOT routing** | One line per category in the sheet: **category → kitchen → printer (IP)**, with *New* or *existing*. Categories using the default kitchen say so; a disabled printer is flagged. **This is the table to check.** |
| **Changes** | New categories, new items, price changes (old → new), unchanged. |

Then press **Import**. Everything is written in one transaction: either the
whole sheet goes in or nothing does.

### Problems (block the import)

- category or item is empty
- price is empty, not a number, has too many decimals, or is out of range
- the same item appears twice in the same category
- the kitchen named doesn't exist or is disabled
- one new category is given two different kitchens
- more than 2000 rows

### Warnings (import still allowed)

- an existing category is given a different kitchen → it keeps its current one
- the category exists but is **disabled** → its items won't show until it's enabled
- a new category has no kitchen and **no default kitchen is set**

---

## 4. Re-importing

Re-importing is safe and expected. Fix the sheet and import it again:

- **Existing item** (same name in the same category) → its **price is updated** if it changed, otherwise untouched. No duplicate is created.
- **New item** → created, available, sort order 0.
- **Item not in the sheet** → **left alone.** The import never deletes or
  disables anything; that stays a deliberate act in Setup.
- **Past invoices are unaffected.** Order lines keep a snapshot of their own name and price.

Matching is by name, so a **renamed** item in the sheet becomes a new item, and
the old one stays until it's disabled in Setup. An item moved to a
different category also becomes a new item in that category.

---

## 5. What it doesn't do

- Create kitchens or printers
- Change an existing category's kitchen
- Delete, disable or rename anything
- Arabic names, modifiers, sort order or availability. Set these in Setup after importing.
- Item codes / SKUs. Matching is by name only.

---

## 6. Audit

Each applied import writes one `audit_log` row: action `master.import_menu`,
the employee who signed in at the counter, and counts of categories created,
items created, items updated and unchanged. A check that wasn't imported writes
nothing.

---

## 7. For developers

| Piece | Where |
|---|---|
| Plan + apply logic | `packages/server/src/services/menu-import.ts` (`importMenu`, `parsePrice`) |
| Route | `POST /api/masters/menu/import` in `packages/server/src/index.ts` |
| CSV parsing, header mapping, template | `packages/admin/src/masters/csv.ts` |
| Dialog | `packages/admin/src/screens/MenuImport.tsx` (button in `Masters.tsx`) |
| Tests | `packages/server/src/__tests__/menu-import.test.ts`, `packages/admin/src/masters/csv.test.ts` |

```http
POST /api/masters/menu/import
{ "rows": [{ "category": "Grills", "item": "Mixed Grill", "price": "55.00",
             "kitchen": "Arabic Kitchen", "line": 3 }],
  "dryRun": true, "employeeId": "…" }
```

- **`dryRun` defaults to true.** Only an explicit `false` writes, so a client bug
  can't import by accident.
- The CSV is parsed **in the browser**; the hub receives JSON rows. Each row
  carries its spreadsheet `line`, and errors/warnings use it as `row`, so messages
  match what the operator sees in Excel even after blank lines are dropped.
- Applying broadcasts `master.changed` for `categories` and `items`, so tablets
  refresh their menu.
- Existing categories are matched **including disabled ones**. Re-importing
  doesn't resurrect a disabled category as a duplicate.
