# Slice 1 — Marketing MVP: submit → draft → approve → publish

Created 2026-07-02. Builds on: Slice 0 proven (fb-publish-test), permanent Page
tokens stored (META_PAGE_TOKENS on prod). NO AI images, NO templates.

## Success criteria (the evals)
1. A manager uploads a store photo from the PWA → it lands in R2 + a D1 row.
2. System drafts a caption from the CURRENT Flow Calendar week (no invented
   prices/dates), plus a safety flag for recognizable people/faces.
3. An admin sees the draft (photo + editable caption + target Page + safety flag),
   can edit/regenerate/reject.
4. Approving publishes the REAL photo + caption to that store's FB Page and logs
   the post id/url.
5. Nothing publishes without explicit admin approval.

## Assumptions (correct me before I build)
- **Storage = Cloudflare R2 for the MVP; Google Drive archival DEFERRED.** Writing
  to Drive from a Worker needs Google service-account auth — not worth it yet. R2
  is in-stack and the Worker writes it natively. (Drive sync can be a later slice.)
- **Captions = Anthropic, reusing `ANTHROPIC_API_KEY`.** Cheap model (Haiku 4.5)
  for captions; verify exact model id via the claude-api skill at build time.
- **Safety check = Claude vision** flags "contains recognizable people/faces" →
  draft marked needs-review (admin can override). Basic, blocking-ish.
- **Store→Page from reversing `STORE_BY_PAGE`**, seeded into facebook_page_targets:
  BL2→264627006733058, BL14→104574708111472, BL16→1000209416518542,
  BL8→222962777911366, BL1(Coliseum)+BL4(Dupont)→113655020488471 (shared page).
- **Roles:** managers see ONLY the Submit-Photos screen (their store). Review /
  approve / publish is admin/superuser only.
- **Build on a branch off main; deploy to PROD behind role gates.** (See open
  decision — a staging=main reset first would give a cleaner test env.)

## Slice 1a — Intake + storage  ✅ (staging, 2026-07-03)
- [x] R2 enabled on the account (Brian). Buckets `bl-marketing-media` (prod) +
      `bl-marketing-media-staging`; wrangler binding `MEDIA` (prod + staging).
- [x] migration-020 (marketing_photos + facebook_page_targets seeded 6 stores);
      applied to STAGING D1. (Prod pending Slice-1 promotion.)
- [x] Worker `POST ?action=photo-upload` (store-gated) → R2 + marketing_photos;
      plus `GET ?action=photo&id=` to serve. Verified via curl: byte-perfect
      round-trip, store validation 400, cleanup done.
- [x] Frontend "Submit Photos" page (nav manager/DM/admin, store selector scoped
      to user's stores, type chips, multi-file + camera capture + thumbs, note).
      Verified in preview (manager sees only their store; correct FormData; success
      + reset). Branch claude/marketing-intake; deployed to STAGING (55e36ad).
- [ ] Brian to test the real upload from his phone on staging.retjghub.com.
- NOTE: staging now carries Slice 1 (diverged from main again — intended; re-sync
  staging=main after Slice 1 merges to main). Prod worker/D1 NOT yet updated.

## Slice 1b — Draft + review
- [ ] migration-021: `marketing_drafts` (id, photo_id, caption, model, safety_flag,
      status, created_at) + `marketing_publish_log` (id, draft_id, store, page_id,
      post_id, post_url, payload, status, created_at).
- [ ] Worker `POST ?action=draft-generate` (photo_id): Claude caption from the
      active Flow Calendar week (theme/product_focus/event/loyalty) + vision safety
      flag → marketing_drafts row. Guardrail: no invented prices/discounts/dates.
- [ ] Frontend: Marketing → "Drafts" tab (admin/superuser): list pending; photo +
      editable caption + target Page + safety flag; edit / regenerate / reject.
- [ ] Verify: photo → sensible draft; edits persist.

## Slice 1c — Approve & publish
- [ ] Worker `POST ?action=publish-draft` (draft_id, admin-gated): resolve Page via
      facebook_page_targets → publish photo+caption (published:true) via
      META_PAGE_TOKENS → write marketing_publish_log (post id/url). Reuse the
      fb-publish-test plumbing (promote it to a real publish path).
- [ ] Frontend: "Approve & Publish" button → published state + link to the post.
- [ ] Verify: approve → real post on the correct Page (test on Battle Creek) →
      logged → visible on Facebook. Delete the test post after.

## Deferred to later slices
- Push/email notify reviewers on new draft (reuse existing patterns).
- Google Drive archival of originals.
- Photo scoring / multi-photo selection, scheduling, reporting (Slice 3).
- Branded templates / AI imagery (Slices 2 & 4).

## Open decisions for Brian
- [ ] Build straight on main→prod (behind role gates), OR do the staging=main reset
      first so there's a clean staging to test on? (Reset is one force-push + a
      worker deploy; recommended before a multi-part build.)
- [ ] Which store to pilot the first real published post on? (Battle Creek is easy.)
- [ ] OK to auto-generate a draft on upload, or only when an admin clicks "draft"?
