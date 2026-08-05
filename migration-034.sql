-- migration-034: eBay Case Handler ingest (Slice 1).
--
-- Receives Handler's (Rajat R's external Node app) state + audit lines. We own
-- the page, the alerting and the notification ledger; Handler owns polling,
-- classification and auto-action. See tasks/ebay-case-handler.md.
--
-- 🔑 `business` is on every table from day one, defaulting to 'ecom'. Brandon
-- opened with "adding other companies", and retrofitting a business column onto
-- a live table with history is the painful version of this. Cheap now.
--
-- Purely additive — three new tables, no existing table touched, so the D1
-- cascade trap does not apply. Rollback is dropping all three.
--
-- ⚠️ Numbered 034: 032 is Boost (on the `staging` branch, never applied to prod)
-- and 033 is the admin ecom grants. Do not reuse either.

-- ── Cases ──────────────────────────────────────────────────────────────────
-- Upserted in full every run, closed cases included. Key is Handler's own
-- `account::caseType::caseId` — case IDs are only unique WITHIN account+type.
CREATE TABLE IF NOT EXISTS ebay_cases (
  case_key            TEXT PRIMARY KEY,
  business            TEXT NOT NULL DEFAULT 'ecom',
  account             TEXT NOT NULL,
  case_type           TEXT NOT NULL,
  case_id             TEXT NOT NULL,

  ebay_state          TEXT,
  is_closed           INTEGER NOT NULL DEFAULT 0,
  buyer_can_escalate  INTEGER,
  respond_by          TEXT,
  first_seen          TEXT,
  last_seen           TEXT,

  -- Per-run scratch from Handler. Stored for display only; ALWAYS recompute
  -- hours-left from respond_by — Handler's `_hoursLeft` drifts between runs.
  decision            TEXT,
  decision_reason     TEXT,
  tier                TEXT,

  title               TEXT,
  sku                 TEXT,
  amount              REAL,

  -- PII, verified scope: these two fields only. buyer_comments is buyer-supplied
  -- and arrives with raw HTML entities → ESCAPE ON RENDER.
  buyer_username      TEXT,
  buyer_comments      TEXT,

  -- Ours, not Handler's. Raj leaves owner/escalateTo empty so there is exactly
  -- one assignment source. Notification ledger lives here.
  owner               TEXT,
  last_notified_at    TEXT,
  notified_via        TEXT,

  raw                 TEXT,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ebay_cases_open
  ON ebay_cases(business, is_closed, respond_by);
-- The UI's two lists: genuinely actionable vs the appeals eBay already owns
-- (ESCALATED + buyer_can_escalate=0). Indexed because that split is every query.
CREATE INDEX IF NOT EXISTS idx_ebay_cases_triage
  ON ebay_cases(business, is_closed, ebay_state, buyer_can_escalate);

-- ── Audit lines ────────────────────────────────────────────────────────────
-- kind: 'run' (event start|finish) | 'decision' | 'action'.
--
-- 🔑 line_hash is UNIQUE and is the dedupe. A non-200 leaves Handler's cursor
-- untouched so the next run RE-SENDS, and he re-sends the whole audit file if it
-- is ever rotated or truncated. Dedupe is therefore load-bearing, not defensive.
-- Hashing the raw line covers the whole tuple; `run` lines carry no case_id at
-- all, which is why a (ts, kind, case_id) key would have collapsed them.
CREATE TABLE IF NOT EXISTS ebay_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business    TEXT NOT NULL DEFAULT 'ecom',
  line_hash   TEXT NOT NULL,
  ts          TEXT,
  kind        TEXT,
  event       TEXT,
  account     TEXT,
  case_type   TEXT,
  case_id     TEXT,
  action      TEXT,
  -- In SHADOW the line is written with dry_run=1 but the CASE record is NOT
  -- marked actioned. Count these and split on dry_run; never infer from the case.
  dry_run     INTEGER,
  ok          INTEGER,
  http_status INTEGER,
  amount      REAL,
  raw         TEXT,
  received_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ebay_actions_hash ON ebay_actions(line_hash);
CREATE INDEX IF NOT EXISTS idx_ebay_actions_recent ON ebay_actions(business, ts);

-- ── Handler state, one row per business ────────────────────────────────────
-- 🔑 Staleness reads last_successful_run_at, NEVER last_run_at: last_run_at
-- advances even on a run where every account failed to authenticate, which is
-- exactly the run that must go red.
--
-- 🔑 effective_mode is the only mode worth storing. It folds per-account config,
-- forcedShadow and the global kill switch. Both accounts currently read
-- mode="live" with forcedShadow=true, so the honest value is SHADOW — storing
-- `mode` would have the page claiming LIVE today.
CREATE TABLE IF NOT EXISTS ebay_handler_state (
  business               TEXT PRIMARY KEY,
  version                TEXT,
  last_run_at            TEXT,
  last_successful_run_at TEXT,
  effective_mode         TEXT,
  account_status         TEXT,
  received_at            TEXT NOT NULL,
  cases_in_payload       INTEGER,
  events_in_payload      INTEGER
);
