# Design System

> One system, two personalities: **Admin PC = light**, **Waiter tablet = dark**.
> Same tokens, same components, different default theme.

---

## 1. Why two themes

| Surface | Theme | Reason |
|---|---|---|
| Admin / cashier PC | **Light** | Long data entry, dense reports, printed-document mental model, often near a bright counter |
| Waiter tablet & phone | **Dark** | Dim dining rooms, less eye strain across a 10-hour shift, better battery on OLED, screen doesn't light up the guest's table |

Both themes are fully defined. Either surface can be flipped in settings — but ship the defaults above.

---

## 2. Target screen sizes

Design to the **smallest** of each, not the biggest.

| Surface | Design at | Notes |
|---|---|---|
| Admin PC | **1366 × 768** | Restaurant PCs are commonly this or lower. Never assume 1920. |
| Admin PC (touch till) | 1024 × 768 | Some POS PCs are 15" 4:3 touch |
| Waiter tablet | **1280 × 800 landscape** | 10" Android |
| Waiter phone | **390 × 844 portrait** | Fallback when no tablet |

⚠️ If a screen only works at 1920×1080, it does not work.

---

## 3. Color tokens

### Brand
| Token | Hex | Use |
|---|---|---|
| `primary` | `#4F46E5` | Primary buttons, active nav, focus ring |
| `primary-hover` | `#4338CA` | Hover / pressed |
| `primary-subtle` | `#EEF2FF` (light) · `#1E1B4B` (dark) | Selected rows, active chips |
| `on-primary` | `#FFFFFF` | Text on primary |

Indigo is deliberate: **green and red are reserved for table/status semantics**, so the brand colour must not collide with them.

### Light theme (Admin PC)
| Token | Hex |
|---|---|
| `bg` | `#F1F5F9` |
| `surface` | `#FFFFFF` |
| `surface-alt` | `#F8FAFC` |
| `border` | `#E2E8F0` |
| `border-strong` | `#CBD5E1` |
| `text` | `#0F172A` |
| `text-muted` | `#64748B` |
| `text-faint` | `#94A3B8` |

### Dark theme (Waiter tablet)
| Token | Hex |
|---|---|
| `bg` | `#0B1220` |
| `surface` | `#151E31` |
| `surface-alt` | `#1E293B` |
| `border` | `#2D3B54` |
| `border-strong` | `#3E4F6E` |
| `text` | `#F1F5F9` |
| `text-muted` | `#94A3B8` |
| `text-faint` | `#64748B` |

### Semantic
| Token | Hex | Meaning |
|---|---|---|
| `success` | `#16A34A` | Free table · settled · printer online · positive variance |
| `warning` | `#F59E0B` | Occupied table · pending print · low stock |
| `danger` | `#DC2626` | Void · cancelled · printer offline · cash short |
| `info` | `#0EA5E9` | Bill printed, awaiting settlement |

### Order type accents
| Type | Hex |
|---|---|
| Dine-in | `#4F46E5` indigo |
| Takeaway | `#F59E0B` amber |
| Car | `#06B6D4` cyan |
| Delivery | `#8B5CF6` violet |

Use the accent as a **left border or chip**, never as a full tile fill — full fills make a busy table grid unreadable.

### Table status
| State | Colour | Also shows |
|---|---|---|
| Free | `success` | table name only |
| Occupied | `warning` | elapsed time, order count badge |
| Bill printed | `info` | total amount |

⚠️ **Never encode status with colour alone.** Every state carries a label, icon or number. Kitchen and floor staff include colour-blind users, and cheap POS panels shift colour badly off-axis.

---

## 4. Typography

**Inter** throughout (fallback: system UI stack). One family, no display font.

| Role | Size / weight | Notes |
|---|---|---|
| Screen title | 24 / 600 | |
| Section heading | 18 / 600 | |
| Body | 15 / 400 | Admin |
| Body (waiter) | 17 / 500 | Larger — glanced at, not read |
| Label | 13 / 500, `text-muted` | Uppercase tracking-wide for table headers |
| Money — normal | 15 / 600 `tabular-nums` | |
| Money — total | 28 / 700 `tabular-nums` | |
| Caption | 12 / 400 `text-faint` | |

### Money rules
- **Always** `font-variant-numeric: tabular-nums`. Without it, columns of digits jitter and look broken.
- **Always right-aligned** in tables and totals.
- Currency label from `settings.currency_display`, never hardcoded.
- Negative values in `danger`, prefixed `−` (U+2212, not a hyphen).

---

## 5. Spacing, radius, elevation

- **Base 4px scale**: 4, 8, 12, 16, 20, 24, 32, 40, 48
- **Radius**: inputs `6px` · buttons `10px` · cards/tiles `12px` · modals `16px`
- **Elevation**: prefer **1px borders over shadows**. Cheap POS panels have poor contrast and shadows turn into grey mud. Shadows only for modals and dropdowns.

---

## 6. Touch targets & density

| Surface | Minimum | Preferred |
|---|---|---|
| Waiter tablet — any tappable | **56px** | 64px for item tiles |
| Waiter tablet — qty +/− | **56 × 56px** | with 8px gap so a thumb can't hit both |
| Admin PC — buttons/rows | 40px | 44px for primary actions |
| Admin PC — table rows | 44px | |

Rules:
- **No hover-only affordances anywhere.** Every action must be reachable by touch.
- **No small `×` close buttons.** Modals close via a full-width button or a 48px hit area.
- Item tiles in the menu grid: 4 columns on tablet landscape, 2 on phone portrait.

---

## 7. Component rules

### Buttons
| Variant | Use |
|---|---|
| Primary (filled indigo) | One per screen. The obvious next action. |
| Secondary (bordered) | Alternate actions |
| Ghost | Tertiary / cancel |
| Danger (filled red) | Void, cancel order, delete |

Waiter app buttons are **full width or half width**, never small inline links.

### Destructive actions
Void, cancel, discount and price override **always** require: confirm dialog → **reason** (preset list, not free text) → writes to `audit_log`. No exceptions. This is the anti-theft feature the owner is buying.

### Status pills
Rounded 6px, 12/600 uppercase, subtle background + solid text of the same hue. Never a bare coloured dot without text.

### Tables (admin)
- Sticky header, zebra `surface-alt`
- Money columns right-aligned, tabular
- Row hover `primary-subtle`
- Empty state: icon + one sentence + primary action button. Never a blank grid.

### Toasts
Bottom-centre, 17px text, 4s. Success `success`, failure `danger` with a **Retry** button. Print failures are toasts on the **cashier PC**, never on the waiter's tablet.

### Loading
**Order entry must never show a blocking spinner.** Optimistic UI: the item appears in the cart instantly. Skeletons are allowed on reports and lists only.

### Offline / disconnected
A persistent amber bar at the top of the waiter app: `Reconnecting to counter…`. Orders continue to queue locally. Never a modal — a modal would stop service.

---

## 8. Printer health indicator

Appears in the admin header at all times:

```
🖨 Arabic ●  Chinese ●  Juice ●  Counter 1 ●
```
Green = reachable, red = unreachable, amber = jobs pending. Clicking opens the print queue panel with per-job **Retry**.

Your support colleague will live on this — treat it as a P0 feature, not a nice-to-have.

---

## 9. Iconography

Lucide icons, 20px admin / 24px waiter, 1.5px stroke. Icons **always** accompany a text label in primary navigation — never an icon-only nav rail.

---

## 10. Tablet has no login — interaction rules

The waiter tablet has no login, no session and no lock. Identity is captured per action. That puts specific demands on the UI:

- **Employee picker is a bottom sheet, not a page.** It appears over the current screen, so the waiter never loses sight of the order.
- **Tiles are 120px minimum**, 4 across on tablet, indigo circle avatar with initials plus the name below at 17px/600. Faces get tapped in a hurry.
- **No pre-selected employee, ever.** One deliberate tap.
- **One tap commits.** No "Confirm" button after picking — the pick *is* the confirmation.
- **The success toast must name the person** — `KOT sent · Rahul` — so a mis-tap is visible immediately.
- **Cancel is a full-width 56px button** at the bottom of the sheet, never a corner ×.

## 11. Action hierarchy — Send vs Save

On the order review screen the two actions are deliberately unequal:

| | Style | Width |
|---|---|---|
| **Send to Kitchen** | filled indigo, 64px | 2/3 |
| **Save without KOT** | bordered, muted text, 64px | 1/3 |

`Save without KOT` must never look as inviting as `Send to Kitchen`. It is the exception path, and a waiter reaching for it by accident means the kitchen never gets the order. Tapping it opens a confirm sheet reading *"Kitchen will NOT receive this order. It will only be added to the bill."*

The button is hidden entirely when the picked employee lacks `can_save_without_kot`.

## 12. Copy tone

- Short, literal, no jargon. `Send to Kitchen`, not `Submit`.
- Errors say what to do: `Chinese Kitchen printer is offline. Tickets are queued. [Retry]` — not `Error 500`.
- Currency and tax words come from settings: `VAT` / `GST`, `TRN` / `GSTIN`.
- English only in MVP. Keep all strings in one file so Arabic can be added later without a rewrite.
- The picker asks `Who is taking this order?` — not `Select employee`. Speak the way the floor speaks.
