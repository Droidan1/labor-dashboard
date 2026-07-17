# Flow Calendar — Phase 2: in-app admin editor

Started: 2026-07-02 · Branch: `claude/flow-calendar-editor` (off staging) · Target: staging first

## Goal
Let admins/superusers edit the Flow Calendar in-app (the app is the source of
truth). Cover BOTH the weekly rows (marketing_flow) and the multi-week segment
bands (flow_segments). Managers keep read-only access.

## Decisions
- Scope: weekly fields + segment bands (full CRUD on segments). [user]
- Deploy: staging first, then user decides prod promotion. [user]
- No schema change — both tables already exist. Code-only.
- Editing UX: an admin-only "Edit" toggle in the header. In edit mode, click a
  week column -> week modal; click a band -> segment modal; click an empty gap
  in a band row -> add-segment modal prefilled with that row + week.
- Segment delete uses an in-modal two-step confirm (NOT window.confirm — this
  staging branch lacks uiConfirm and native confirm freezes the installed PWA).
- Week dates (week_start/week_end) are fixed retail calendar — not editable.

## Worker (worker.js) — 3 admin-gated endpoints (requireInventoryAccess) ✅
- [x] POST `?action=flow-week-upsert` — UPDATE marketing_flow editable fields by
      (fiscal_year, retail_week); 404 if week missing; set updated_at.
- [x] POST `?action=flow-segment-upsert` — INSERT (no id) or UPDATE (by id) a
      flow_segments row; validate week range + color key + section.
- [x] POST `?action=flow-segment-delete` — DELETE flow_segments by id.

## Frontend (index.html) ✅
- [x] `#fc-edit-toggle` + `#fc-add-seg` buttons in fc header; gated in applyRoleUI.
- [x] State: fcCanEdit/fcEditMode/fcEditWk/fcEditSeg; `fcToggleEdit()`.
- [x] Render: data-fcwk on weekly cells; data-fcseg on band cells; data-fcaddrow
      /data-fcaddwk on empty band-row gaps (edit mode). `fc-editing` cursor class.
- [x] Event delegation `fcTblClick` on #fc-tbl (attached once).
- [x] Week modal + fcEditWeek/fcCloseWeek/fcSaveWeek.
- [x] Segment modal + fcEditSegment/fcAddSegment/fcCloseSeg/fcSaveSeg + 2-step delete.
- [x] `fcPost(action, body)` helper (POST, credentials:'include').
- [x] On save: patch local fcWeeks/fcSegments, re-render, close.

## Verify
- [x] Local: mocked GET+POST via preview. Verified: admin sees Edit; manager does
      not & can't enter edit mode; week edit (correct POST body, re-render);
      segment edit/add-via-gap/two-step delete; start>end blocked with no POST;
      no console errors.
- [ ] Staging: `wrangler deploy --env staging` + Pages deploy; real admin session;
      edit a week + a segment; confirm persists on reload. (PENDING user go-ahead.)

## Review
- Code-only (no schema change). New branch `claude/flow-calendar-editor` off
  staging; also carries the earlier Flow Calendar contrast/color polish.
- Exposed fcEditWeek/fcEditSegment on window (symmetric with fcAddSegment) so the
  delegation entry points are testable; harmless in prod.
- Segment delete uses in-modal two-step confirm (no window.confirm → PWA-safe).
- NOT deployed yet — awaiting approval for the staging (external) step.
