# Same-day sales forecast — design note

> Status: **Future feature** · planned, not built
> Captured 2026-05-27 from a design conversation; revisit when ready to scope.

## What it is

A same-day forecast: given today's sales-so-far (at whatever hour we're at)
plus the store's history, predict where the day will land — and how confident
we are.

The goal is **operator decision support**, not magic. An operator should be
able to glance at a store card mid-morning and know:

- "Are we on track to hit budget today?"
- "If not, by how much will we miss?"
- "How confident is that?"
- "What's different about today vs a normal Tuesday?"

## Data we already have, ranked by usefulness

1. **Day-of-week × hour-of-day curves** — most powerful by far. The dashboard
   has 13+ weeks of hourly history per store via the `?action=hourly` worker
   endpoint and the daily snapshots in KV. "On Tuesdays by 11 AM, Coliseum
   has historically done 28% of its full-day net" — that one number unlocks
   most of the forecast.
2. **Recency-weighted trajectory** — last 2–4 weeks' Tuesdays are more
   predictive than 12-weeks-ago Tuesdays. Recency weighting matters more
   than sample size.
3. **Channel mix tilt** — today's Bin / Retail split vs the store's norm. A
   bin-heavy day usually means lower ASP and a different afternoon shape.
4. **Item-level signals** — Furniture orders correlate with bigger baskets
   and later-day activity. We already capture L2 categories and L3
   sub-categories per snapshot.
5. **External signals (NOT in our data today)** — weather, day-of-month
   proximity to payday, local events. Would need to be added if we want them.
   Probably not worth it for v1.

## Three approaches, in order of complexity

### Approach 1 — Statistical baseline (recommended start)

Pure stats, no ML:

- Compute each store's "% of full-day net completed by hour H" averaged over
  the last 13 same-day-of-week instances.
- Given today's actual sales at hour H, project forward:
  `projected_EOD = sales_so_far / historical_pct_at_this_hour`
- Wrap in a confidence band derived from the standard deviation of those 13
  same-day-of-week instances.

**Pros:**

- ~50 lines of code in the worker
- Runs in milliseconds
- Explainable ("based on your last 8 Tuesdays")
- Zero ongoing model maintenance
- No API costs
- Probably 80% as accurate as anything fancier

**Cons:**

- Brittle on anomalies (holidays, local events)
- Doesn't reason about *why* today is different from normal

### Approach 2 — LLM narrative on top of (1)

Once the statistical forecast is trustworthy, layer an LLM call for human
commentary:

> Coliseum is tracking **9% behind** its usual Tuesday morning pace. Bin
> sales are unusually light today (~31% of typical). If the afternoon
> recovers to normal, EOD lands around **$8,400**, just under budget. If
> the bin slump continues, you're looking at **$7,600**.

The LLM doesn't *forecast* — that's the statistical model's job. It
*narrates* and reasons about deviations.

**Pros:**

- Adds real qualitative value an operator can act on
- LLM can reason about anomalies the statistical model misses

**Cons:**

- API cost (~$0.001–0.01 per call)
- Latency (~1–3s per call)
- Need to cache aggressively (once per hour per store is plenty)

### Approach 3 — Real ML (probably overkill)

Per-store regression model trained weekly, features include hour, dow,
channel-mix, items, etc. Output: full probability distribution of EOD net.

**Skip unless 1+2 demonstrably aren't accurate enough.** Marginal accuracy
gain isn't worth the operational complexity for a 6-store retail dashboard.

## Recommended phased build

### Phase 1 — Statistical baseline + confidence band (~2 days)

Worker endpoint `?action=forecast&store=BL1&hour=11` returns:

```json
{
  "store": "BL1",
  "dayOfWeek": 2,
  "hour": 11,
  "salesSoFar": 2840.50,
  "projectedEod": 7950.00,
  "confidenceLow":  7530.00,
  "confidenceHigh": 8370.00,
  "samplesUsed": 8,
  "method": "historical-pct-of-day"
}
```

Frontend shows the forecast as a **secondary fill on each store's pace bar**
in a lighter shade of green, with the confidence band as a faint shaded
region. Numeric forecast appears in a small chip next to the pace %.

**Gate behind an opt-in toggle** in the hero "More" section so operators
choose to see it. Validate accuracy by silently logging predictions vs
actual EOD for 2 weeks before declaring it trustworthy.

### Phase 2 — LLM narrative (~1 day)

Cache per-store, per-hour. Surfaces as a small expandable "why?" link next
to the forecast.

### Phase 3 — Real ML (only if needed)

If Phase 1+2 have measurable gaps after a couple of months of operation.

## UX considerations

The big risk isn't accuracy — it's **operator trust**. Three things to get
right:

### 1. Show your work

Don't just say "EOD projected $7,950". Say:

> **$7,950** projected · based on 8 Tuesdays' afternoon shape · ±$420
> confidence band

Operators have to feel like they can audit the number.

### 2. Show uncertainty visibly

A point estimate is a lie.

- On the pace bar, draw a **secondary fill** in lighter green showing the
  projected final position. Bonus: a faint shaded band showing the
  confidence interval.
- In text: "likely **$7,600–$8,200**" not just "$7,950".

### 3. Gate it behind a deliberate UI moment

Don't put the forecast next to the actuals on the store card by default —
that conflates "this is what is" with "this is what might be" and operators
will eventually confuse them.

Options, best to worst:

- **Toggle in the hero "More" section**: "Show forecasts" — opt-in
- **"Projected EOD ↗" chip** on each store card that expands the prediction inline
- **Dedicated "Forecast" tab** on the store detail page

## ⚠️ One thing to be careful about

**Don't let the forecast hide bad days.**

If a store is at 23% pace and the forecast says "still on track to hit
$7,000 of $8,500 — 82%", an operator might breathe a sigh of relief when
actually 23% at 11 AM IS already a bad day worth investigating.

**Forecasts should *augment* the existing pace signals, never replace them.**
Keep the red pace bars red even when the forecast is optimistic. The
forecast is a *secondary* signal, not the headline number.

## Open design questions for when we start

1. Where exactly does the forecast surface live? (Hero, store cards,
   dedicated tab?)
2. Should forecasts be available on past days too (back-testing UX)?
3. How do we surface "today is anomalous" — e.g. when the confidence band is
   unusually wide because today doesn't look like a normal Tuesday?
4. Should the notification bell fire a critical alert if the forecast says
   we're likely to miss by > X%?
5. How do we handle new stores with little history? (Indy East was discussed
   as a 2026 opening.)
6. Cron timing — recompute hourly? On-demand? Both?

## Related work referenced

- See `index.html` `renderCards` for the existing pace-bar render path.
- See `worker.js` `?action=hourly` endpoint for the hourly data we'd consume.
- See KV snapshots `items:STORE:DATE` for historical L2/L3 detail.
