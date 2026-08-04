# SellerCloud REST API — pre-meeting brief

Prepared 2026-07-30 for the e-com hub kickoff. Everything below is from
SellerCloud's public docs (links at the bottom); gaps are marked as gaps rather
than guessed.

---

## Take these questions into the meeting

1. **What is our team name / server endpoint — and are we on `.com` or `.us`?**
   SellerCloud is per-tenant; there is no single global host.
2. **Is each e-com site a separate SellerCloud _Company_, or one Company with
   multiple _channels_?**
   ← *Most important question.* It decides whether our per-site cards key off
   `companyID` or `channel`, and therefore the whole data shape.
3. **Who creates the integration user, and can it start read-only?**
4. **Is there a test/sandbox tenant, or is it live-only?** (Docs mention none.)
5. **Roughly how many orders/day across all sites?** Decides whether the
   50-records-per-page cap is a footnote or a design constraint.
6. **Do we need order-level detail, or just daily totals per site?** Detail means
   storing line items; totals means a much smaller sync.

---

## The three things needed before any code

### 1. Server endpoint (per-tenant)

```
GET https://api.sellercloud.com/api/server-by-team/?team={our_team_name}
```

Returns a `RestApiEndpoint`. Documented patterns:

```
https://xx.api.sellercloud.com/rest/
https://xxxxxxx.api.sellercloud.us/rest/
```

### 2. A dedicated integration user

SellerCloud explicitly recommends a **separate employee account per
integration**. Do not reuse a person's login — it breaks when they leave, and
their API traffic becomes indistinguishable from a human's.

### 3. Auth: username/password → bearer token

```
POST {RestApiEndpoint}/api/token
Content-Type: application/json

{ "Username": "...", "Password": "..." }
```

Response fields: `access_token`, `token_type`, `username`, `expires_in`,
`.issued`, `.expires`

Then on every subsequent call:

```
Authorization: Bearer {access_token}
```

**No refresh token.** On expiry, re-POST the credentials.

⚠️ **Docs contradict themselves on lifetime:** the prose says *"valid for 60
minutes"* while the sample response shows `expires_in: 1800` (30 minutes).
**Trust `expires_in` from the live response — do not hardcode either value.**

---

## Their data model already matches the per-site card idea

SellerCloud has a first-class **Company** concept, orders carry `CompanyID` /
`CompanyName`, and there is a **Get All Companies** endpoint. So "a card per
e-com site" is not something we invent — we list companies, then aggregate
orders grouped by `companyID`. Structurally identical to the six Bargain Lane
store cards.

---

## The endpoint that produces a dashboard

```
GET {RestApiEndpoint}/api/orders
```

**Filters:**

| parameter | notes |
|---|---|
| `companyID` | list |
| `channel` | list |
| `orderStatus` | Cancelled, ShoppingCart, Completed, InProcess, ProblemOrder, OnHold, Quote, Void |
| `createdOnFrom` / `createdOnTo` | DateTime |
| `OrderFromDate` / `OrderToDate` | date |
| `ShipFromDate` / `ShipToDate` | date |
| `sku` | string |
| `pageNumber` | default 1 |
| `pageSize` | default 10, **max 50** |

**Response** — wrapper has `Items[]` plus `TotalResults` (record count, for paging).

Per order: `ID`, `TimeOfOrder`, `GrandTotal`, `StatusCode`, `CompanyName`,
`ShippingStatus`, `PaymentStatus`, `TrackingNumber`.

Per line item (`Items[]`): `DisplayName`, `Qty`, `QtyShipped`, `QtyReturned`,
`LineTotal`, `StatusCode`.

→ `GrandTotal` + `TimeOfOrder` + `CompanyID` is everything needed for a
per-site daily sales card. **`QtyReturned` matters** — returns should be netted
out, the same way refunds are handled for Clover today.

---

## The constraint that shapes the architecture

**Rate limit: 10,800 requests/hour, per user per IP.** All endpoints count.
That is ~3 req/sec — which sounds generous until combined with the **50-record
page cap**: a day with 5,000 orders is 100 requests to read one day, for one
company.

**Two consequences:**

1. **Do not call SellerCloud from the browser on page load.** Pull on a schedule
   into our own store; have the dashboard read that. This is exactly the pattern
   already used for Clover (cron → D1 → dashboard). Keeps the e-com dashboard
   fast and stops five people opening the app from burning quota.

2. **Throttling response is non-standard.** On exceeding:

   ```json
   { "Error": "Too many requests.", "RateLimitResetTime": "2022-01-14T09:38:49.9856571Z" }
   ```

   The docs **do not state an HTTP status code** and mention **no `Retry-After`
   header**. Retry logic must read that timestamp out of the body. Note our
   existing Clover retry helper keys off HTTP 429 — confirm what status
   SellerCloud actually returns.

---

## Documented gaps — treat as unknown, not absent

- **No sandbox/test environment is mentioned anywhere.** Assume live data until
  told otherwise; start the integration user read-only.
- **Public endpoint docs are thin.** The real reference is **Swagger, per
  tenant** — append `/swagger/ui/` to the endpoint:
  `https://xx.api.sellercloud.com/rest/swagger/ui/`. Once we have credentials
  that beats the public docs for exact parameter shapes.
- No API version path prefix is documented.

---

## Recommended first step

One read-only worker endpoint that proves the whole chain end to end:

> look up server → get token → pull yesterday's orders for one company →
> return `{ company, orderCount, grandTotalSum }`

If that number matches what SellerCloud's own UI shows for that day, everything
after is incremental. It also settles token lifetime, the real throttle status
code, and paging behaviour by observation instead of assumption.

**Sequencing note:** this would be the **fourth** external API in `worker.js`,
and there is currently no shared HTTP client — three different Clover retry
policies, the Clover base URL hardcoded 31 times, Meta with no client at all.
SellerCloud's non-standard throttling is a good forcing function to extract one
`apiClient({ baseUrl, auth, retry })` **before** adding it, rather than creating
a fourth ad-hoc style.

---

## Sources

- [Getting Started — REST API](https://developer.sellercloud.com/dev-category/getting-started-rest-api-new/)
- [Authentication](https://developer.sellercloud.com/dev-article/authentication/)
- [REST Services Overview (+ Swagger)](https://developer.sellercloud.com/dev-article/rest-services-overview/)
- [REST API Rate Limiting](https://developer.sellercloud.com/dev-article/rest-api-rate-limiting/)
- [Get All Orders](https://developer.sellercloud.com/dev-article/get-all-orders/)
- [Company Services](https://developer.sellercloud.com/dev-category/company-services/)
