-- migration-068: a decryptable copy of an associate's code, so an admin can read it back.
--
-- Brian, 2026-09-16: "On the user page for Associates, I want admins to be able to view
-- their pin number in case Associates forget it." Shown both options as a rendered
-- preview; he picked the one that stores codes recoverably, knowing the two costs in
-- tasks/todo.md.
--
-- 🛑 READ THIS BEFORE ASSUMING THIS MIGRATION MAKES EXISTING CODES VIEWABLE. IT DOES NOT.
-- `pin_hash` is HMAC-SHA256(PIN_PEPPER, code) and is one-way. Every code that exists when
-- this lands stays unreadable FOREVER — this column is filled only when a code is next
-- SET. So after applying this, every associate on the list still reads "not recoverable"
-- until their code is replaced once. That is not a bug in the migration; it is the
-- property of the hash, and the UI says so per row rather than pretending otherwise.
--
-- ── What the three objects are for ──────────────────────────────────────────────────────
--
-- 🔑 `pin_cipher` IS A CONVENIENCE COPY. `pin_hash` REMAINS THE ONLY THING LOGIN CHECKS.
-- This is the load-bearing decision of the whole change. associate-login verifies against
-- `pin_hash` and never reads this column, so a leak of the cipher key is a DISCLOSURE —
-- bad — rather than an AUTH BYPASS, which would be catastrophic. If a future change ever
-- makes login consult `pin_cipher`, that property is gone and this comment is a lie.
--
-- Format: base64( 12-byte IV || AES-GCM ciphertext ), with the user's id as additional
-- authenticated data. The AAD is why a row swap fails: dropping Maria's `pin_cipher` into
-- Dave's row does not decrypt, rather than showing Maria's code under Dave's name.
--
-- 🔑 ENCRYPTED UNDER `PIN_CIPHER_KEY`, A SECOND SECRET — NEVER `PIN_PEPPER`. One secret
-- doing both jobs would mean a single leak breaks the hash defence and the cipher at the
-- same time, and it would make this feature impossible to switch off on its own. With two,
-- `npx wrangler secret delete PIN_CIPHER_KEY` revokes every reveal while every associate
-- keeps signing in normally. That is the rollback for the FEATURE; see below for the
-- rollback for this migration.
--
-- `pin_set_at` is when the code was last set. It exists so the reveal modal can say
-- "set 2026-09-09, before codes were stored recoverably" instead of an unexplained
-- refusal — the difference between a UI that looks broken and one that looks deliberate.
--
-- `pin_reveals` is the audit trail. Reading somebody's live credential is an act worth a
-- record, and the worker writes the row BEFORE it returns the code: a failed audit fails
-- the reveal. An unauditable reveal is worse than a refused one.
--
-- 🔑 NO FOREIGN KEY ON `pin_reveals`, DELIBERATELY, FOR TWO REASONS.
--   1. migration-029's cascade trap — an ON DELETE CASCADE across child tables is how this
--      database has lost rows before.
--   2. The log must OUTLIVE the user it names. A reveal of a since-deleted associate's code
--      is exactly the record an audit wants to keep, so `user_name` and `revealed_by_label`
--      are denormalised copies: the log stays readable when the rows they came from are gone.
--
-- ── Apply ───────────────────────────────────────────────────────────────────────────────
-- Address databases by UUID; the staging one lives under [env.staging] and a bare name does
-- not resolve. STAGING FIRST:
--   staging:     npx wrangler d1 execute b40982c2-4009-4842-bc17-fa0977468b07 --remote -y --file=migration-068.sql
--   production:  npx wrangler d1 execute 3fa911d7-31d6-438c-985f-7ac08c407d2d --remote -y --file=migration-068.sql
--
-- Confirm it landed (expects two column rows, then the table):
--   npx wrangler d1 execute <uuid> --remote -y --json \
--     --command="SELECT name FROM pragma_table_info('users') WHERE name IN ('pin_cipher','pin_set_at')"
--   npx wrangler d1 execute <uuid> --remote -y --json \
--     --command="SELECT name FROM sqlite_master WHERE type='table' AND name='pin_reveals'"
--
-- 🛑 NOT RE-RUNNABLE. `ALTER TABLE ADD COLUMN` takes no IF NOT EXISTS, as migration-059
-- proved on production: a second run errors with `duplicate column name: pin_cipher`. That
-- error is harmless and means the column is already there — check with the pragma above
-- rather than re-running. The CREATE TABLE and CREATE INDEX below DO take IF NOT EXISTS, so
-- only the two ALTERs are at stake.
--
-- 🔑 DEPLOY ORDER: THIS FIRST, THEN THE WORKER, THEN THE FRONTEND. Derived from which side
-- stops being backward-compatible (CLAUDE.md rule 6), not from last time. The new worker
-- SELECTs `pin_cipher` and `pin_set_at`, so against a database without them every
-- list-users call throws — that is the incompatible direction. Adding columns an old worker
-- never names is invisible to it, so this is safe to apply while the current worker runs.
--
-- 🔑 ADDITIVE ONLY. No row is read, rewritten or deleted. Every existing column keeps its
-- value, and both new columns arrive NULL on every existing row, which is precisely the
-- "not recoverable" state the UI renders. Rollback is:
--     DROP TABLE IF EXISTS pin_reveals;
--   and leaving the two columns in place — SQLite's DROP COLUMN is unavailable on D1's
--   version for a column this old-style ALTER added, and an unread NULL column costs
--   nothing. To undo the FEATURE without touching schema at all, delete the secret.

-- The decryptable copy. NULL for every code set before this migration, and for any code set
-- while PIN_CIPHER_KEY is unconfigured — both read as "not recoverable", which is honest.
ALTER TABLE users ADD COLUMN pin_cipher TEXT;

-- When the code was last set. NULL means "before this shipped", which is what lets the modal
-- explain an unrecoverable code rather than merely refusing one.
ALTER TABLE users ADD COLUMN pin_set_at TEXT;

-- Who read whose code, and when. Written before the code is returned; see worker.js.
CREATE TABLE IF NOT EXISTS pin_reveals (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  user_name         TEXT,
  revealed_by       TEXT NOT NULL,
  revealed_by_label TEXT,
  revealed_at       TEXT NOT NULL
);

-- The question this table gets asked is "who has looked at this person's code lately",
-- newest first.
CREATE INDEX IF NOT EXISTS idx_pin_reveals_user ON pin_reveals(user_id, revealed_at DESC);
