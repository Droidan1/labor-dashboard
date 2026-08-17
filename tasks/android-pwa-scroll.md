# Android PWA scroll lock — investigation

**Reported:** scrolling sticks on the Weekly Retail Summary page, and the page sticks during
photo upload. Android only; iPhone unaffected. Newer Android untested.

**Investigated 2026-08-17.** Measurements taken in Chromium at 375×812 with Android mobile
emulation, serving the real `index.html` + `tailwind.css` from the repo (`.claude/launch.json`
→ "Frontend (static)").

---

## Confirmed by measurement

### Layout baseline (needed to read everything below)

`#app` is `min-h-screen flex`; `#main-scroll` is `flex-1 … overflow-y-auto`. Because `#app` has
no fixed height, `#main-scroll` stretches to its own content height and **never scrolls — the
document scrolls.** Measured: `clientHeight === scrollHeight === 4624` with `overflow-y: auto`,
`overflow-x: hidden`, `overscroll-behavior: contain`.

### 1. The Weekly Retail Summary page is ~95% horizontally-scrollable table

Measured on a faithful reproduction of one `renderL2Card` (12 L2 rows + 65 L3 rows × 13 week
columns + Total, sticky-left first column, heat `<span>` per cell — [index.html:15559](index.html:15559)):

| metric | value |
|---|---|
| viewport | 375 px |
| table content width | 1044 px |
| **horizontal overflow per card** | **671 px** |
| cards horizontally scrollable | 6 / 6 |
| **page height inside a horizontal scroller** | **18 462 / 19 470 px = 94.8 %** |
| DOM nodes | 13 992 |
| sticky cells | 468 |

The real page emits more than the 6 tested: `renderWrsSummary()` has 2 `overflow-x-auto` wrappers
([15150](index.html:15150), [15189](index.html:15189)) and `renderT13()` emits **7 cards**
(5 × `renderL2Card` + 2 × `derivedCard`, [15665–15750](index.html:15665)), each with its own
wrapper. So ~9 full-bleed horizontal scrollers stacked vertically.

**Mechanism.** Chrome on Android applies a **touch gesture direction lock** from the first few
pixels of movement. A thumb swipe arcs; if the initial motion reads as even slightly horizontal
and the element under the finger has 671 px of horizontal travel to give, the gesture locks to
horizontal **for its entire duration** — the user drags up and down and nothing moves. Lift and
re-swipe and it works. iOS Safari re-evaluates the lock more forgivingly, which is why iPhone
users do not report it. Because ~95 % of this page is inside such a scroller, there is almost
nowhere to put a thumb that is not in one — which is why this page specifically.

**Status: leading explanation. Needs confirmation on a real device** (see "To confirm" below).

### 2. Photo upload holds every original at full resolution

[`spRenderThumbs()` index.html:12894](index.html:12894):

```js
d.innerHTML = `<img src="${URL.createObjectURL(f)}" class="w-full h-full object-cover">` + …
```

- **The object URL is never revoked.** `grep -n revokeObjectURL index.html` → 3 hits, all
  elsewhere ([10742](index.html:10742) CSV download; [12927/12931/12934](index.html:12927) are
  `spMakeThumb`'s own temp URL). `spRenderThumbs()` runs again on every `spFilesChange()` and
  every `spRemoveFile()`, minting a fresh set each time and leaking the previous set. Each live
  URL pins the whole original `File` blob.
- **The `<img>` is the full-resolution original**, painted into a ~100 px `aspect-square` box, so
  Chrome decodes the entire JPEG. Android phones shoot 12–108 MP; a 50 MP decode is ≈200 MB of
  bitmap. Ten photos is multiple GB of decode pressure.
- [`spSubmit()` index.html:12939](index.html:12939) then uploads the **full-res original**
  (`fd.append('photo', f)`) serially, decoding each image a second time for `spMakeThumb`.

iOS WebKit caps image-decode memory hard and discards decoded bitmaps aggressively; Chrome on
Android is far more permissive, so the renderer thrashes or gets OOM-killed — which presents as
the page freezing. **Status: confirmed in code; explains the Android-only asymmetry.**

### 3. A non-passive `touchmove` on `document` (contributing factor)

The swipe-back handler ([index.html:20321](index.html:20321)) registers
`document.addEventListener('touchmove', …, { passive: false })` unconditionally, and only ever
calls `preventDefault()` when the touch started within 24 px of the left edge. Chrome cannot know
that in advance, so **every touchmove on every page must round-trip to the main thread** before
scrolling can proceed. The handler body itself is cheap (measured 0.0027 ms average over 300
dispatches) — the cost is the scheduling dependency, which turns any main-thread stall (e.g. the
14 k-node WRS render) into visible input lag. Compounds #1 rather than causing it.

---

## Ruled out — do not chase these

- **`overscroll-behavior: contain` on `#main-scroll` blocking scroll chaining.** Tested 8
  safe-area-inset values (0, 16, 24, 24.5, 16.875, 21.33, 34, 27.428 px): `scrollHeight ===
  clientHeight` in every case, so the box is never user-scrollable and Chrome never puts it in
  the scroll chain. The `contain` is inert. My sub-pixel-rounding theory was wrong.
- **`position: sticky` cost.** 468 sticky cells vs the same tree with `position: static`:
  median scroll layout 2.6 ms vs 2.5 ms. No meaningful difference.
- **chartjs-plugin-zoom / Hammer.js capturing touch.** No `zoom:`/`pan:` config exists anywhere
  in `index.html`, so the plugin attaches no listeners. (Hammer is still a dead ~20 KB load —
  separate, cosmetic.)
- **Service worker serving a stale bundle.** Update path is correctly wired: `CACHE_NAME`
  `dashboard-cache-v82`, `skipWaiting` + `clients.claim()` + a `controllerchange` reload listener
  ([index.html:19809](index.html:19809)). Worst case is one launch on the previous build.

---

## Proposed fixes

### Fix 1 — Weekly Retail Summary (root cause of the scroll stick)

Preferred: **stop the tables overflowing on phones at all.** 13 week-columns on a 375 px screen
is unreadable regardless; show the most recent 4–6 weeks by default on mobile with a "show all
weeks" toggle. If nothing overflows, there is no horizontal scroller and the gesture lock cannot
arm.

Cheaper partial, if all 13 weeks must stay: collapse the T13 cards into an accordion on mobile so
only one table is expanded at a time. That drops horizontal-scroller coverage from ~95 % of the
page to roughly one screen, leaving most of the page safe to thumb against.

`overscroll-behavior-x: contain` on the wrappers is worth adding either way, but it stops scroll
*chaining*, not the direction lock — it is not a fix on its own.

### Fix 2 — Photo upload ✅ IMPLEMENTED 2026-08-17 (not yet deployed)

`spFiles` now holds `{ file, thumb, url }` entries instead of bare `File`s, so the preview object
URL is owned by the entry — minted once when the file is picked, revoked once when it is removed.
Re-rendering the grid no longer mints anything.

- `spClearFiles()` (new) is the single path that empties `spFiles`; called from
  `initSubmitPhotos()` and after a successful submit.
- `spMakeThumb` → **`spDownscale(file, max, quality)`**. Returns an image whose long edge is at
  most `max`, which may be the original `File` when it is already that small (no pointless
  re-encode), or `null` on failure.
- The preview tile paints the ~320 px copy. If it is not ready yet — or generation failed — the
  tile is a neutral placeholder, deliberately **not** a fallback to the original, since that
  decode is the whole problem.
- The thumbnail generated at pick-time is reused at submit; `spSubmit` no longer recomputes it.
- The upload itself is capped at 2048 px long edge. This also fixes uploads that previously
  **failed outright** — [worker.js:9166](worker.js:9166) rejects anything over 15 MB, which a
  modern Android photo can exceed on its own.
- Thumb is only attached when it really is `image/jpeg`, because
  [worker.js:9178](worker.js:9178) stores thumbs with a hardcoded `image/jpeg` content type.
- `sw.js` `CACHE_NAME` bumped **v82 → v83** — without it installed PWAs keep the old bundle,
  which would defeat the entire fix.

**Verified in Chromium at 375×812 (Android emulation), driving the real `#sp-files` input and
the real handlers:**

| check | result |
|---|---|
| preview dimensions (from a 4000×3000 source) | **320×240**, was 4000×3000 |
| preview bytes, 8 photos | **104 KB total**, was 3.68 MB — 35.5× |
| decoded bitmap, 8 photos | **~2.5 MB**, was ~384 MB |
| URLs unchanged across re-render | ✅ (old code minted a fresh set every render) |
| remove revokes that URL only, survivors alive | ✅ |
| reset revokes all | ✅ |
| portrait 3000×4000 upload | **1536×2048** — long edge capped, aspect preserved |
| already-small 300×200 upload | passed through untouched, not re-encoded |
| upload under the worker's 15 MB limit / thumb under 512 KB | ✅ |
| `npm test` | 1488 assertions, 41 suites, all pass (worker-side only) |

⚠️ Measurement note for anyone re-running this: the Browser pane runs as a hidden tab, so
`canvas.toBlob`'s callback is throttled to ~1 s — a 2×2 canvas measured 1080 ms while the
synchronous 320×240 encode took 1.9 ms. An early run reported "9.2 s for 8 photos"; the real cost
is ~50 ms/photo. Do not optimise against a hidden-tab timing.

⚠️ Also caught during verification: the local page was served the **old** bundle by the service
worker (`dashboard-cache-v82`) and the first test silently measured pre-fix behaviour. Unregister
the SW and clear caches before testing a frontend change locally.

### Fix 3 — Touch listener

Register the swipe-back `touchmove` as passive by default and attach the non-passive variant only
after a `touchstart` lands in the 24 px edge zone, removing it on `touchend`/`touchcancel`.
Restores the compositor fast path for every other gesture on every page.

---

## To confirm on a real device

Needed because the direction-lock behaviour cannot be reproduced through emulated input:

1. Android phone + USB debugging → `chrome://inspect` from a desktop Chrome, with the **installed
   PWA** (not a browser tab — the PWA is what users run).
2. On the Weekly Retail Summary page, swipe vertically with a thumb starting **on a table**, then
   the same starting on the page header (outside any table). If the header swipe scrolls reliably
   and the table swipe sticks, Fix 1 is confirmed.
3. Performance panel while uploading 8–10 photos: watch renderer memory and look for the decode
   spikes described in #2.
4. Also worth capturing: exact Android version, Chrome version, and phone model — Chrome's
   direction-lock heuristics have changed across versions, which may be why newer phones behave
   differently.
