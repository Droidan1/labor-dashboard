# Dashboard Design System

Living spec for the Bargain Lane operator dashboard. Captures the design
direction, tokens, components, and interaction patterns built into
`index.html`. Goal: anyone touching the dashboard later can extend it
consistently without re-deriving choices from screenshots.

The redesign currently lives on the `staging` branch and is served at
`https://staging.retjghub.com`. Production (`www.retjghub.com`) is still
the pre-redesign app on GitHub Pages until a deliberate cutover.

---

## 1. Direction — V1 "Operator"

One of three variants in the original handoff (`/tmp/retjg_redesign/...`
when it was attached). Picked because:

- It's a refined evolution of the existing dark + green dashboard, so
  user retraining is minimal.
- Persistent left sidebar on desktop matches the existing nav model.
- The original screenshots set the bar; the implementation tracks the
  V1 desktop + mobile artboards closely with intentional deviations
  noted inline below.

Mood: operational, dense, dark room of monitors.

---

## 2. Design tokens

All tokens live in `tailwind.config.js` under `theme.extend`. Tailwind
generates the utility classes; `scripts/build.sh` runs `tailwindcss` so
new tokens automatically compile when used in `index.html`.

### 2.1 Colors

Two palettes — dark is primary; light is the secondary mode controlled
by the existing `.dark` class on `<html>`.

**Operator dark (`op-*`) — primary**
| Token | Hex |
|---|---|
| `op-bg` | `#0a0f1a` |
| `op-panel` | `#101826` |
| `op-panelHi` | `#16203a` |
| `op-border` | `rgba(255,255,255,0.06)` |
| `op-borderHi` | `rgba(255,255,255,0.10)` |
| `op-ink` | `#e7ecf3` |
| `op-inkDim` | `#8893a7` |
| `op-inkDimmer` | `#5a6478` |
| `op-good` | `#22c55e` |
| `op-bad` | `#ef4444` |
| `op-warn` | `#f59e0b` |
| `op-sidebar` | `#070b14` |
| `op-glass` | `rgba(22,32,58,0.55)` |

**Operator light (`opl-*`)**
| Token | Hex |
|---|---|
| `opl-bg` | `#f4f3ee` |
| `opl-panel` | `#ffffff` |
| `opl-panelHi` | `#fafaf6` |
| `opl-ink` | `#14110a` |
| `opl-inkDim` | `#6b6453` |
| `opl-sidebar` | `#ece8dc` |
| `opl-bad` | `#c0392b` |

**Accents** (`accent-*`) — selectable palette; `green` is the default.
`green` is also reused as `bg-accent-green/10` etc. for tinted tiles.

| Token | Hex |
|---|---|
| `accent-green` | `#22c55e` |
| `accent-emerald` | `#10b981` |
| `accent-lime` | `#b5ff3c` |
| `accent-blue` | `#3b82f6` |
| `accent-amber` | `#f59e0b` |
| `accent-pink` | `#ec4899` |
| `accent-violet` | `#8b5cf6` |

**Pacing semantics** (used by hero bar, store-card pace meter,
sparkline color, delta):

- **Green** when `actual >= budget` (target met or beat).
- **Amber** when `pct >= 80 && pct < 100` (close but behind).
- **Red** otherwise.

### 2.2 Typography

| Use | Family | Weights | Loaded via |
|---|---|---|---|
| Body / UI | **Geist** | 400/500/600/700 | Google Fonts |
| Brand mark + store-card name + page heading | **Lilita One** | 400 | Google Fonts |
| Tabular numerics | **Geist + `tabular-nums`** (no separate mono needed for hero/cards) | — | — |
| Available but currently unused | **JetBrains Mono** | 400/500/600 | Google Fonts |

The original Poppins / Luckiest Guy stack is still loaded so any
remaining `font-display`/`font-body` references on un-V1'd screens
(Store Detail, Inventory, etc.) keep working. Don't remove until
those screens are V1-converted.

All currency / count displays use `tabular-nums` for column alignment.

### 2.3 Spacing & radius

V1 "comfortable" density:

| Property | Value |
|---|---|
| Card padding (desktop) | `p-5` → `p-6` for hero |
| Card padding (mobile) | `p-5` |
| Grid gap (top sections) | `gap-4` (desktop), `gap-0` (mobile, dividers handle it) |
| Card radius | `rounded-card` (16px) for hero/budget; `rounded-[10px]`/`[8px]` for tiles |
| Pill radius | `rounded-full` for LIVE/OFFLINE and section dividers |
| Inner tile radius | `rounded-[8px]` |

### 2.4 Effects

- **Shadows:** none. Cards use border + tinted bg.
- **Transitions:** `transition-colors`, `transition-[width]` on bars,
  `transition-transform` on sheet/scroll-hide. Standard duration
  ≈ 0.28s, ease `cubic-bezier(0.4, 0, 0.2, 1)`.
- **Skeleton shimmer:** `.skel` class (defined in `<style>`). Linear
  gradient sweeping 1.6s; respects `prefers-reduced-motion`.

---

## 3. Layout & shell

### 3.1 Desktop (≥1024 px) — sidebar + main

- **Sidebar** (`#sidebar`): persistent, `op-sidebar` bg, 256 px wide
  / 64 px collapsed. Nav items: Dashboard, Weekly Retail Summary,
  Inventory, Supply Request, Users, Admin Settings, Settings. Role-
  gated items (`#nav-inventory`, `#nav-users`, `#nav-admin-settings`,
  `#nav-settings`) start `.hidden` and are revealed by app logic.
  Active nav item = `bg-accent-green/10` + `text-accent-green` pill.
- **Main scroller** (`#main-scroll`): `flex-1 overflow-y-auto`. The
  document itself scrolls (the flex parent is `min-h-screen`), so
  the window's scroll position is the source of truth for "Am I at
  the top?" / scroll-hide logic — listen on `window`, not the inner
  div.

### 3.2 Mobile (<1024 px) — bottom nav + main

- **Sidebar:** `max-lg:hidden`. The old mobile hamburger
  (`#mobile-menu-btn`) is force-hidden via `!hidden` so the app's
  per-page nav logic can't reveal it.
- **Bottom nav** (`#bottom-nav`, `lg:hidden`): fixed bottom bar with
  five tabs — Dashboard, Weekly, Inventory, Supply, **More**
  (horizontal ellipsis "•••"). Role-gated tabs (`bn-inventory`,
  `bn-supply`) hide when the user lacks access, mirroring sidebar
  visibility.
- **More sheet** (`#more-sheet`): slide-up bottom sheet, opens via
  the More tab. Contains user identity, Users / Admin Settings /
  Settings (role-gated), Dark mode toggle (delegates to existing
  `#dark-toggle`), Sign out.
  - Dismiss: tap the scrim OR swipe down on the grab handle. The
    swipe handler uses `pointermove` non-passive + `preventDefault`
    to consume the gesture so it can't chain into iOS pull-to-
    refresh.
- **Scroll hide/show**: the bar gets `translate-y-full` when the
  user scrolls *down* past 40 px; it returns on any upward scroll.
- **iOS safe areas:**
  - `<meta name="viewport" content="...viewport-fit=cover">` so
    `env(safe-area-inset-*)` reports real values.
  - Bar's bottom padding includes `env(safe-area-inset-bottom)` so
    tabs clear the home-indicator gesture area.
  - Sticky app-bar headers use `pt-[calc(env(safe-area-inset-top)+1rem)]`
    so the header background covers the notch strip and content
    sits below it. Applied to every `.bg-opl-panel.dark:bg-op-panel.border-b…sticky.top-0` header
    (8 instances across pages).

### 3.3 Page app bar

Every page begins with a sticky app bar (`bg-opl-panel dark:bg-op-panel
border-b ... sticky top-0 z-10`) holding the page heading and any
top-right actions (refresh, etc.). Heading uses Lilita One brand font
(`font-brand`), uppercase, accent green: `text-2xl font-brand
text-accent-green uppercase tracking-wide`.

---

## 4. Dashboard components

### 4.1 Hero "Today's Sales · All Stores" card

`#today-total-card`. Desktop = 3-column row (1.6fr / 1fr / 1fr) with
the hero in the first slot and Channel Mix / Matrix to its right.
Mobile = the whole 3-up section becomes **one continuous card** via
`max-lg:` chrome on the section + `lg:` chrome on the individual
cards; Channel Mix + Matrix render as inner divider-separated
sections inside the hero card on mobile.

**Inside the hero card:**
- Top label "TODAY'S SALES · ALL STORES" (live label dynamically
  prefixed; in non-live views the label becomes
  `${periodLabel} · All Stores`).
- Big tabular total (`text-4xl sm:text-5xl`, Geist 700, tracking-tight).
- Delta line: **colored ± delta** + **white "vs $budget"** (the budget
  side is larger and white so it reads as a separate important number).
- Pace block (right): "PACE" label + big pct % + "X of Y reporting".
  Pct color follows the pacing scheme (green / amber / red).
- Progress bar: 8 px track + accent fill. **Bar caps at 100% width**
  even when pct > 100 (target met = full).
- View Details link (calls `showAllStoresDetail()`).

**Mobile accordion** ("Phase 2.5"): below `lg` the Channel Mix +
Matrix collapse into a `Show channel mix & matrix ▾` toggle, default
collapsed. Implemented as `display: grid; grid-template-rows: 0fr ↔
1fr` on `#hero-extra` with an inner overflow wrapper. Desktop
overrides `#hero-extra` and its inner wrapper to `display: contents`
so the inner cards become direct grid items again — no DOM moves
needed for the responsive flip. State persisted in
`localStorage.heroExpanded`.

### 4.2 Channel Mix panel

Three rows — Retail (accent green), BIN (accent blue), Auction
(accent violet) — each with `$amount` (white, tabular) and a
proportional horizontal bar (`h-1.5`) scaled to the max of
(grandTotal, channel values).

### 4.3 Matrix · Today

Four metric tiles: Avg Cart, Avg Items, Orders, ASP. Same chrome as
the store-card metric tiles (`rounded-[8px]`, `border-accent-green/20`,
`bg-accent-green/10`, accent-green uppercase label, **white value**).
**Responsive grid:** `grid-cols-4 lg:grid-cols-2` — single row on
mobile, 2×2 on desktop (because the Matrix sits in a narrower 1fr
column at lg+ where 4-up would crowd).

### 4.4 Combined budget card

`#budget-sec`. Aggregates Weekly + Monthly all-stores totals against
their targets.

- **Desktop:** two separate cards side-by-side (`lg:grid-cols-2`)
  via the same `display: contents` trick on `#budget-detail`.
- **Mobile:** one collapsible card. Default **collapsed**; the
  closed face shows a slim two-column summary — Weekly amount/budget
  on the left, Monthly · Month on the right, chevron. Tap to expand;
  expanded face shows the full Weekly + Monthly blocks (each with
  totals, inline delta, pace-colored progress bar, footer with
  "% of target" + remaining / days-left).
- Pacing bar colors: amber (behind) / green (on or above). Bar
  caps at 100% (same convention as hero).
- **Number formatting:** detail blocks use **exact dollars**
  (`fmtDollar`); the collapsed mobile summary keeps **abbreviated
  $K** for compactness.
- Closing the expanded sheet: tap the slim chevron-only row at the
  top of the detail face (no header text).

### 4.5 Viewing Week bar

A slim panel row that controls which week (and optional day) the
dashboard is showing.

- **Layout (responsive via flex `order`):**
  - Desktop: `[Week N ▾]   [day chip] [day chip] ... [last day chip]   [View Week]` — View Week pushed to the far right with `lg:ml-auto`.
  - Mobile: `[Week N ▾]   [View Week]` on the top line, day chips wrap to a horizontal-scrollable second row.
- **"View Week" button**: solid `bg-accent-green` when the
  week-aggregate view is active (no day picked); dashed-border dim
  otherwise. Clicking it sets `selectDashDay(null)`.
- **Day chips**: dashed border pills (mobile = stacked weekday/date,
  desktop = inline). Selected day = solid accent green. Today
  always shows `● LIVE`. If a different day is selected, today's
  chip gets an accent-green outline instead of full fill. Future
  days = dimmed disabled.
- **No "Week" chip in the strip** — the dropdown is the week
  control; the dashboard's week-aggregate view is reached via the
  View Week button (or by clicking the active day chip to toggle
  back to the week).

### 4.6 Store cards (V1 unified)

`#store-cards` is a `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` of
identical store cards. The original three-branched template
(`cardShowLive` / historical / day) was unified into one V1 card
template that adapts its values by mode.

**Card anatomy:**
1. **Header row** — store name (`font-brand`, brand font, 2xl) +
   code, with a LIVE / OFFLINE pill on the right. Pill border + dot
   color: green when actually transacting today; dim otherwise.
2. **"Today's Net" line** — uppercase label (or `${period} Net` in
   non-live views), big Geist tabular total, **delta line** with
   colored ± part and the **white "vs $budget"** side larger for
   emphasis.
3. **Sparkline** (right of the total) — see §4.7.
4. **Pace meter** — label + pct (color by pacing) + horizontal bar
   filling proportional to pct (cap at 100%).
5. **Channel tiles** (`grid-cols-3`) — Retail / BIN / Auction;
   plain dim chrome (not accent). Always **exact $** values
   (`fmtDollar`).
6. **Metric tiles** (`grid-cols-4`) — Cart / Items / Orders / ASP;
   accent-green tinted chrome, accent-green label, white value.
   Single row 4-up at all sizes (the cards are narrow enough that
   2×2 felt cramped, and the handoff's mobile artboards used 4-up).
7. **View Details →** button at bottom-right. **Clicking the card
   body itself does nothing** — only the button navigates (gives
   us room for richer in-card interactions later).

**Per-mode data sourcing** (the part the unified template hides):
- `v1Total`: live mode = today's live net; non-live = period's
  `combinedTotal`. (Critical: never use `combinedTotal` in live
  mode — it double-counts today.)
- `v1Budget`: live mode = today's row budget; non-live = period
  budget.
- `v1Retail/Bin/Auction`: prefer live, fall back to row's actuals
  or historical aggregates.

### 4.7 Hourly sparkline (per store card)

After each card mounts, an async fetch hits
`?action=hourly&store=<key>&date=<sel-or-today>` and renders an
inline-SVG sparkline of that day's hour-by-hour net sales. The
slot is a fixed `104×44` div with an id; the loader fills its
`innerHTML` when the fetch resolves. Leading and trailing zero
hours are trimmed for readability. Stroke + fill color follow the
card's pacing (green if ahead, red if behind). Empty days render
nothing.

**Tooltip (Phase 4)**: pointer-events listener on the slot draws a
vertical guide + dot + small chip "`8 AM · $1,234`" on hover/scrub.
`touch-action: pan-y` so a horizontal swipe scrubs the tooltip
while vertical scroll still works. Tap-without-scrub falls through
to no-op (card no longer has a click handler).

---

## 5. Interaction patterns (reusable)

| Pattern | Where used | Implementation note |
|---|---|---|
| Mobile accordion | Hero (`#hero-extra`), Budget (`#budget-detail`) | `grid-template-rows: 0fr ↔ 1fr` + inner `overflow: hidden`; CSS class swap on parent toggles. Use `display: contents` at `lg:` to "untangle" the wrapper for desktop. |
| Slide-up sheet | More menu (`#more-sheet`) | `position: fixed; bottom: 0; translate-y-full ↔ 0`; scrim with `opacity-0` ↔ visible. Touch-drag handle uses non-passive `touchmove + preventDefault`. |
| Scroll hide/show | Bottom nav | Listener on `window` (the document scrolls, not `#main-scroll`). Toggle `translate-y-full` based on direction; threshold ≥40 px to avoid jitter. |
| Skeleton shimmer | Hero total, store-card total | `.skel` with sized width/height matching the final content. |
| Inline retry | Store cards on fetch failure | `liveCloverErrors[store]` / `histErrors[store]` populated in `loadAll` per-store try/catch. Card renders "Couldn't load · Retry" instead of the total; Retry calls `retryStore(store)`. |

---

## 6. Data states

The card adapts its content based on which of these is true:

| State | Big-number area | Card chrome |
|---|---|---|
| Loading | `.skel` block | normal |
| Has data | `fmtDollar(total)` | normal |
| Offline today (live view + no live sales) | "No transactions yet" small dim | `opacity-60` (dimmed) |
| Fetch failed | "Couldn't load" + Retry button | normal |
| Historical / day view with no data | `—` | normal (no dim — absence of "live" isn't a fault) |

The OFFLINE pill always reflects "not transacting now" (live view +
no liveSales); in historical views the pill still says OFFLINE
because the live signal isn't present, but the card isn't dimmed.

---

## 7. Responsive breakpoints

Tailwind defaults: `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`.
The dashboard primarily uses **`lg` (1024 px) as the desktop /
mobile dividing line** — that's where the bottom nav appears, where
the hero collapses to one card, and where the budget pickers go
single-card.

- `<lg` (mobile + small tablet): bottom nav, single-card hero, slim
  collapsible budget, day chips horizontal-scroll, hamburger gone.
- `≥lg` (desktop): persistent sidebar, 3-column hero row, two
  separate budget cards, day chips wrap inline.

The intermediate `768–1023 px` (mid-tablet) currently behaves like
mobile. The original handoff left this range unspecified.

---

## 8. Number formatting conventions

- **Store cards:** always **exact dollars** (`fmtDollar`).
  Includes Retail / BIN / Auction tiles and the "vs $budget" delta
  side. No `K` abbreviation.
- **Hero:** exact dollars for the big total and the "vs $budget"
  delta side. The bar footer also shows the exact budget amount
  (`#c-today-budget`).
- **Combined budget card detail blocks:** exact dollars
  (`c-total`, `c-budget`, `c-month-total`, `c-month-budget`).
- **Mobile collapsed budget summary:** abbreviated `$K`
  (`bgt-sum-*`) for compactness — that row stays slim.
- **Sparkline tooltip:** whole dollars (`Math.round(v).toLocaleString()`)
  to keep the chip compact.

---

## 9. Accessibility

- All interactive elements that previously were clickable `<span>`s
  were converted to real `<button>`s for native focus / keyboard.
- The mobile More sheet uses `aria-pressed` semantics on the tab
  buttons and a real `<button>` for each row.
- `prefers-reduced-motion` disables the `.skel` shimmer and the
  sheet/accordion transitions.
- iOS tap targets are kept ≥40 px height where realistic (bottom
  nav tabs, More sheet rows, View Details). Day chips intentionally
  stay slim per user request — flag if you change.

---

## 10. Build pipeline

- `scripts/build.sh` is run by Cloudflare Pages on every push to a
  branch attached to a Pages project. It:
  1. Copies the static frontend (`index.html`, `sw.js`,
     `manifest.json`, icons, `BLlogo.svg`, `html/*`) into `dist/`.
  2. **Runs `npx tailwindcss` to regenerate `dist/tailwind.css`**
     from `tailwind.config.js`. Don't rely on the committed root
     `tailwind.css` — it'll go stale.
  3. Rewrites the frontend API base on non-`main` branches:
     `https://api.retjghub.com` → `https://api-staging.retjghub.com`
     so previews talk to the staging worker.
  4. Writes a `_headers` file telling Cloudflare not to cache
     `sw.js` or `index.html`, so a stale service worker can't pin
     users to an old build.

If you add new design tokens to `tailwind.config.js`, they'll only
compile into the served CSS once *something* in `index.html`
actually references the class (Tailwind JIT). To force a token in
without using it yet, add a `safelist` entry (not currently done).

---

## 11. Out of scope / future

Things that are explicitly **not** in the redesign yet and worth
flagging when you pick them up:

- **Per-channel budgets** (retail / bin budget). The data model
  has only a single `budget` column on `daily_sales`. Adding
  `retail_budget` / `bin_budget` requires a Sheet-side change, a
  migration (`migration-014`), a worker ingest change, and a small
  frontend wiring step. Until that lands, "vs budget" comparisons
  only exist for the all-stores total.
- **Retail/BIN tile flip animation** — user-requested but depends
  on per-channel budgets existing.
- **Other pages not V1-converted:**
  - Inventory page
  - Supply Request page
  - Users page
  - Admin Settings page
  - Store Detail page (uses the new selector style now, but
    internal content/charts are pre-redesign)
  - Weekly Retail Summary (selector restyled; inner T13 tables and
    item tables still original)
- **Intermediate width 768–1023 px**: behaves like mobile.
- **Channel Mix / Matrix on past-day views** — currently always
  computed from "today" aggregates; for historical day drill they
  should pull from `historicalCloverData[store][dateKey]`. Not
  blocking, just stale-feeling on past-day views.
- **`storeTrend()` helper** is dead code — left in place from the
  original Phase 3 (weekly trend sparkline before switching to
  hourly). Safe to remove when convenient.

---

## 12. Cheat sheet — common classes

```html
<!-- Card -->
<div class="bg-opl-panel dark:bg-op-panel
            border border-[rgba(20,16,8,0.08)] dark:border-op-border
            rounded-card p-5 transition-colors">…</div>

<!-- Small uppercase label -->
<div class="text-[11px] font-semibold uppercase tracking-[0.1em]
            text-opl-inkDim dark:text-op-inkDim">Channel Mix</div>

<!-- Big tabular total -->
<div class="font-geist font-bold tabular-nums tracking-tight
            text-4xl sm:text-5xl text-opl-ink dark:text-op-ink">$35,091.54</div>

<!-- Page heading (brand font) -->
<h1 class="text-2xl font-brand text-accent-green
           uppercase tracking-wide">Dashboard</h1>

<!-- Pace bar (track + fill) -->
<div class="h-2.5 rounded-full overflow-hidden
            bg-[rgba(20,16,8,0.06)] dark:bg-[rgba(255,255,255,0.06)]">
  <div class="h-full rounded-full bg-accent-green
              transition-[width] duration-500" style="width:0%"></div>
</div>

<!-- Accent metric tile (matches store-card mtile + hero matrix tiles) -->
<div class="rounded-[8px] border border-accent-green/20 bg-accent-green/10
            px-2.5 py-2.5 text-center">
  <div class="text-[10px] font-bold uppercase tracking-[0.06em]
              text-accent-green">CART</div>
  <div class="mt-1 text-sm font-bold tabular-nums
              text-opl-ink dark:text-op-ink">$24.77</div>
</div>

<!-- LIVE pill (inline style for dynamic color) -->
<span class="inline-flex items-center gap-1.5 px-2.5 py-1
             rounded-full text-[11px] font-bold tracking-[0.06em]"
      style="border:1px solid rgba(34,197,94,0.4);color:#22c55e">
  <span style="width:6px;height:6px;border-radius:9999px;background:#22c55e"></span>
  LIVE
</span>
```
