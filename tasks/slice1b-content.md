# Slice 1b/1c — Bin post composer (refined 2026-07-03)

Refines the old "AI drafts everything" idea per Brian: admin-controlled, premade
thumbnails, AI for text only.

## The flow
1. Managers upload **bin photos** (✅ Slice 1a).
2. Admin/superuser opens the composer, picks submitted bin photo(s) + a
   **premade thumbnail** (cover), and either **writes the caption** OR clicks
   **"AI generate"** (Claude drafts it from the Flow Calendar week).
3. Review → **publish** as a multi-photo Facebook post: **thumbnail first
   (cover), then the selected bin photos**, with the caption.

## Locked decisions
- **Post layout:** multi-photo FB post — premade thumbnail is the cover image,
  selected bin photos follow. NO image compositing.
- **AI scope:** text only. Images are always admin-provided premade thumbnails.
  (No Gemini/image-gen vendor yet.)
- **Pilot type:** bins first.
- **Roles:** compose/publish + thumbnail management = admin/superuser only.
  (Managers only upload photos.)

## Data (migration-021)
- `marketing_thumbnails` (id, r2_key, name, content_type, bytes, uploaded_by,
  active, created_at) — the premade thumbnail library.
- `marketing_drafts` (id, store, thumbnail_id, photo_ids JSON, caption,
  caption_source 'manual'|'ai', status 'draft'|'approved'|'published'|'rejected',
  created_by, created_at, updated_at).
- `marketing_publish_log` (id, draft_id, store, page_id, post_id, post_url,
  response, status, created_at).

## Slice 1b-1 — Thumbnail library (admin) ← START HERE
Foundational + unblocks Brian providing thumbnails.
- [ ] migration-021 (marketing_thumbnails at minimum).
- [ ] Worker: `thumbnail-upload` (admin, multipart→R2+row), `thumbnails` (list),
      `thumbnail?id=` (serve), `thumbnail-delete` (soft: active=0).
- [ ] Admin UI: upload + grid of premade thumbnails (Marketing → new admin
      subitem, or Admin Settings section).
- [ ] Verify via curl + preview.

## Slice 1b-2 — Composer + review (admin)
- [ ] `marketing-photos?store=&status=new` (admin: list submitted photos to pick).
- [ ] Composer UI: select photo(s) + thumbnail + caption; save draft.
- [ ] `draft-save`, `drafts` (list), `draft-delete`.

## Slice 1b-3 — AI caption option
- [ ] `draft-generate-caption` — Claude (Haiku) from active Flow Calendar week;
      guardrail: no invented prices/dates. Returns text for admin review/edit.

## Slice 1c — Publish
- [ ] `draft-publish` — multi-photo FB post via META_PAGE_TOKENS: upload
      thumbnail (published=false) + each photo → /feed with attached_media +
      caption → publish → marketing_publish_log. Reuse fb-publish plumbing.
- [ ] "Approve & Publish" button; show published state + link.

## Needed from Brian
- The premade thumbnail image(s) to seed the library (any time before we test 1c).
