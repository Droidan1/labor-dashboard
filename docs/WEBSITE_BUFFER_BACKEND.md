# Bargain Lane website + RETJG HUB + Buffer

The custom customer website shares HUB's Cloudflare Worker, D1 and R2 content backend. HUB remains the signed-in staff application. Buffer receives approved captions and stable image URLs through a server queue. This branch prepares the backend and HUB controls; it does not activate a live Buffer account or replace bargainlane.com.

## Implemented foundation

- `migration-078.sql`: website campaigns, bin photo sets, shared website prices, per-store Buffer channel mappings a durable delivery outbox, and separate Buffer approval snapshots.
- `GET /website/content?store=BL1`: anonymous, read-only public feed. Only approved campaigns/galleries within their validity window appear. Drafts, private media, storage keys, user details and financial records are excluded. Scope uses the six active HUB stores. No credentials or cookies are needed. The endpoint is `no-store`; future frontend caching must preserve expiry enforcement.
- `website-control.html`: phone-friendly HUB admin screen, linked from Content Studio. Uses HUB's existing session, business gate, photos and drafts. Eastern times convert to UTC independently of the device time zone. Skipped or repeated DST hours are rejected.
- `?action=website-content-admin`: approved administrators receive editable campaign/gallery records plus safe photo picker data and existing draft captions.
- `website-campaign-save` and `website-photo-set-save`: draft / approved / archived, date window, store scope and optimistic revision checks. Saving approved content makes it eligible for public reads during its window.
- `website-pricing-save`: one shared website schedule, including Friday before/from 2 PM ET. This does not alter Clover prices.
- `buffer-status`, `buffer-channel-save`, `buffer-approve-draft`, `buffer-queue-draft`, `buffer-cancel-job`: account status without secrets, store channel mapping, caption approval, snapshot queue and cancellation of unsent jobs only.
- Existing every-minute Worker trigger processes the new Buffer outbox independently of existing POS and Meta tasks. Credentials and an explicit delivery flag are both required. Queueing or approval alone never sends.

Administrators/superusers with Bargain Lane access approve website content and outbound posts in this first release. Existing managers keep their upload flow; publishing role delegation is not added. The existing reporting MCP remains read-only. Future publishing MCP tools need separate scoped authority and should call these same business operations.

## API examples

All signed-in actions use `credentials: include` from HUB's allowed origin. GET reads and JSON POST writes use the existing `/?action=...` convention. The browser never receives the Buffer API key.

Campaign save:

```json
{
  "title": "Ready to Host",
  "description": "Furniture offer. See store for exclusions.",
  "department": "Furniture",
  "discount": 30,
  "stores": ["BL1", "BL4"],
  "photoId": null,
  "startsAt": "2026-10-14T09:00:00-04:00",
  "endsAt": "2026-10-16T00:00:00-04:00",
  "status": "draft"
}
```

Creation returns `id` and `revision`. Updates also send `id` and `expectedRevision`. A stale revision returns 409. Gallery saves use `store` and `photoIds` instead of sale fields, and accept only that store's bin photos. Dates require an explicit UTC offset.

Caption approval sends `draftId`, `caption`, and the draft's current `expectedUpdatedAt`. Queueing sends:

```json
{
  "draftId": 123,
  "expectedUpdatedAt": "the approved draft updated_at value",
  "channelId": "0123456789abcdef01234567",
  "dueAt": "2026-10-16T13:00:00Z",
  "requestId": "a-client-generated-unique-request-id"
}
```

Reuse the same request ID after a lost response. The request key and draft/channel/time uniqueness prevent duplicate queue records. The exact caption, photo IDs, store and version must have a Buffer approval snapshot. Editing an approved draft invalidates that approval. The draft must be approved, the channel must belong to the draft's store, and publishing time must be at least a minute ahead. Queueing snapshots the approved caption and photo IDs. Later draft edits do not rewrite an accepted post.

The public customer website uses:

```js
const response = await fetch(
  'https://api-staging.retjghub.com/website/content?store=BL1',
  { credentials: 'omit', cache: 'no-store' }
);
if (!response.ok) throw new Error('Content unavailable');
const { campaigns, galleries, binPricing } = await response.json();
```

Render text with normal escaping. Hide expired content locally as well as refreshing the feed when the page regains focus. Use a neutral offer fallback when the feed is unavailable; never substitute stale prices or offers. The design review defaults to sample content and includes a read-only “HUB staging feed” toggle. `customer.html` uses the staging feed by default. It omits credentials, validates store scope and image origins, clears offers/prices on fetch failure, refreshes on focus and every 30 seconds, and removes expired content at the expiry boundary. The staging endpoint returned HTTP 401 on October 15, so live data activation is still pending.

## Buffer delivery contract

The Worker calls Buffer's official GraphQL API at `https://api.buffer.com`, using a Worker-only `BUFFER_API_KEY`. `createPost` uses `customScheduled`, UTC `dueAt`, `automatic`, `needsApproval: false` and `saveToDraft: false`. Test the authorized account's channel policy in staging; rejected provider policies become failed jobs. Channels requiring Buffer-side approval need a deliberate policy addition, not a client bypass.

Supported photo-post services are Facebook, Instagram, Google Business, Threads and TikTok. The dispatcher sends each service’s required metadata. Limits are 10 photos for Facebook/Instagram/TikTok, 20 for Threads, and one for Google Business; Instagram and TikTok require at least one. Only JPEG, PNG and WebP are accepted. TikTok photo posts omit video-only AI settings.

Image assets reuse HUB's existing public `/p/<id>-<object-uuid>.<ext>` URLs. Buffer requires publicly reachable media until publication; expiring signed URLs are unsuitable. Raster retail/bin/event photos are eligible; team/private formats are excluded. Delivery rechecks media and channel availability. Photo deletion is blocked for queued, submitting, scheduled or uncertain Buffer jobs.

- `queued`: waiting for enabled delivery.
- `submitting`: claimed atomically for one request.
- `scheduled`: Buffer accepted and returned a post ID. This is not proof of publication.
- `failed`: validation failed or Buffer explicitly refused the mutation.
- `needs_review`: remote outcome is unknown; never automatically resend. Inspect Buffer first.
- `cancelled`: an unsent HUB queue record was cancelled.

A stalled submission becomes `needs_review` after ten minutes. Cancel or edit accepted posts in Buffer. Media remains protected for accepted/uncertain posts; retention reconciliation and a publication webhook/status sync are future work. Existing direct Meta publishing stays separate; do not schedule the same draft through both delivery paths.

HUB's existing AI caption drafts remain available. Buffer AI works inside Buffer for rewriting captions. This bridge does not call a Buffer AI generation endpoint. Official MCP documentation supports an additional interactive connection; MCP is not the unattended scheduler.

## Staging rollout

1. Inspect the staging schema read-only first. Migration 078 has not been applied by this continuation; if an earlier copy exists, reconcile its foreign key and service constraints before rollout. The current migration creates six additive tables, changes no POS prices, sales or labor records, and gives campaign hero references `ON DELETE SET NULL`. Apply migration 078 before deploying this Worker. The new photo-delete guard reads the new outbox table, so deploy order matters.

   ```sh
   npx wrangler d1 execute labor-dashboard-db-staging --env staging --remote --file=migration-078.sql
   npx wrangler deploy --env staging
   ```

2. Build the frontend with `CF_PAGES_BRANCH=feature/shared-website-buffer`. The build allowlist includes the new control page and rewrites its API origin to staging. Verify a real HUB admin session and manager denial on staging.
3. Keep delivery paused. Authorize the intended Buffer account and put its API key through Wrangler's interactive secret input:

   ```sh
   npx wrangler secret put BUFFER_API_KEY --env staging
   ```

4. Fetch the real account's channels through the authorized Buffer developer tools/MCP, then map each channel to the correct store. No fake or assumed channel IDs belong in live data.
5. Test with an approved draft and a dedicated test social channel. Set `BUFFER_PUBLISH_ENABLED` to the exact string `true` only for this deliberate test. Verify the accepted post ID and Buffer schedule before allowing routine publishing. A credential alone keeps delivery paused.
6. Test active/future/expired website windows, store targeting, stable media after acceptance, concurrent edits, lost responses and paused delivery. Confirm current prices and policy copy.
7. Connect the custom customer frontend to the staging public feed, then complete real phone/browser QA and planned migration from WordPress URLs. Production migration, Worker rollout, Buffer connection and public domain cutover are separate rollout steps after staging verification.

This checkout adds no live credentials, deployment flags or real channel mappings. Never commit API keys or put keys in frontend configuration.

## Validation

The shared-content regression suite runs the actual Worker against SQLite-backed D1 and R2 stubs. It checks permissions, public field filtering, approval, time windows, scope, revisions, price validation, media revocation, channel matching, duplicate prevention, disabled delivery, mocked provider acceptance, photo protection and uncertain outcomes. It sends no real social posts.

Run `npm ci`, `npm test`, and the staging frontend build. Live Buffer account authorization, provider policy, actual image retrieval and remote publication still require the staging steps above.

Primary references:
- https://developers.buffer.com/guides/posts.html
- https://developers.buffer.com/guides/media.html
- https://developers.buffer.com/guides/integrations/mcp.html

## Continuation verification — October 15, 2026

- Recovered backend tree exactly matched pushed commit `08e0e49`; no existing PR was present.
- `npm test`: 9,900 assertions across 114 suites passed, including 92 shared website/Buffer assertions. The three mock-server suites require local loopback permission.
- `CF_PAGES_BRANCH=feature/shared-website-buffer npm run build` passed.
- HUB controls checked at 390px and 1440px in light, dark and OLED themes using local, read-only fixtures; no horizontal overflow. Measured body/muted/button contrast: minimum 5.62:1.
- Customer review: all five pages in three directions at 390px and 1440px; no overflow or broken images. Store selection and missing-feed fallback verified. Feed unit checks cover expiry, store scope, stale responses, rejected media URLs and failed refreshes.
- Buffer connector read-only inventory: eight connected channels, four Facebook, three Google Business and one TikTok. No Instagram channel was returned. South Bend, Battle Creek and Indy Facebook labels are explicit. Google has one South Bend and two Fort Wayne profiles; the latter require exact Coliseum/Dupont verification. The shared Facebook page and chain TikTok account also need an intentional store-routing policy. No mappings, posts, schedules, credentials, flags, migrations or Worker deployments were changed.
- Public website remains a private design review. bargainlane.com has not been replaced.
