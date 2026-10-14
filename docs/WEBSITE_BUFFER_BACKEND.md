# Bargain Lane website + RETJG HUB + Buffer

The custom customer website shares HUB's Cloudflare Worker, D1 and R2 content backend. HUB remains the signed-in staff application. Buffer receives approved captions and stable image URLs through a server queue. This branch prepares the backend and HUB controls; it does not activate a live Buffer account or replace bargainlane.com.

## Implemented foundation

- `migration-078.sql`: website campaigns, bin photo sets, shared website prices, per-store Buffer channel mappings and a durable delivery outbox.
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
  "channelId": "0123456789abcdef01234567",
  "dueAt": "2026-10-16T13:00:00Z",
  "requestId": "a-client-generated-unique-request-id"
}
```

Reuse the same request ID after a lost response. The request key and draft/channel/time uniqueness prevent duplicate queue records. The draft must be approved, the channel must belong to the draft's store, and publishing time must be at least a minute ahead. Queueing snapshots the approved caption and photo IDs. Later draft edits do not rewrite an accepted post.

The public customer website uses:

```js
const response = await fetch(
  'https://api-staging.retjghub.com/website/content?store=BL1',
  { credentials: 'omit', cache: 'no-store' }
);
if (!response.ok) throw new Error('Content unavailable');
const { campaigns, galleries, binPricing } = await response.json();
```

Render text with normal escaping. Hide expired content locally as well as refreshing the feed when the page regains focus. Use a neutral offer fallback when the feed is unavailable; never substitute stale prices or offers. The current design review stays sample-driven until this staging feed is deployed and connected.

## Buffer delivery contract

The Worker calls Buffer's official GraphQL API at `https://api.buffer.com`, using a Worker-only `BUFFER_API_KEY`. `createPost` uses `customScheduled`, UTC `dueAt`, `automatic`, `needsApproval: false` and `saveToDraft: false`. Test the authorized account's channel policy in staging; rejected provider policies become failed jobs. Channels requiring Buffer-side approval need a deliberate policy addition, not a client bypass.

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

1. Apply migration 078 before deploying this Worker. The new photo-delete guard reads the new outbox table, so deploy order matters.

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
