-- migration-061: the Associate account — a name, a six-digit code, and a set of pages.
--
-- An associate is a floor worker: no company email, a shared warehouse phone, and no
-- business seeing the dashboard. They sign in with a name and a six-digit code from the
-- login screen's "Associate login" button, and an admin decides page by page whether they
-- may VIEW it, EDIT on it, or not open it at all.
--
-- 🔑 REUSES THE EXISTING `staff` ROLE rather than adding an 'associate' one. `staff` is
-- already in both CHECK constraints (users.role from migration-029, user_grants.role from
-- migration-030), already sits OUTSIDE FINANCIAL_ROLES so the worker's financial gate
-- closes ~85 money actions to it today, and tasks/projects-tasks-permissions.md already
-- reserves it for "Retail Lead, associates, seasonals". A new value would mean ALTERing a
-- CHECK, which SQLite cannot do in place — that is the migration-029 table rebuild and its
-- ON DELETE CASCADE trap across five child tables. The UI says "Associate"; the column
-- says 'staff'.
--
-- 🔑 `pin_hash IS NOT NULL` IS THE DISCRIMINATOR, not the role. Every guard added by this
-- change asks that question, so if a future `staff` user ever logs in by email instead,
-- the 12-hour session and the no-passkey rule keep applying to code-login accounts only.
--
-- ⚠️ NOT RE-RUNNABLE. ALTER TABLE ADD COLUMN takes no IF NOT EXISTS — migration-059 proved
-- that on production, where a second run died with "duplicate column name: sup_ref". A
-- half-applied run is safe to finish by hand: drop the statements that already succeeded.
--
-- Apply (address databases by UUID; the staging one lives under [env.staging] and a bare
-- name does not resolve):
--   npx wrangler d1 execute b40982c2-4009-4842-bc17-fa0977468b07 --remote -y --file=migration-061.sql
--   npx wrangler d1 execute 3fa911d7-31d6-438c-985f-7ac08c407d2d --remote -y --file=migration-061.sql
--
-- Columns only. No row is read, rewritten or deleted, and every existing account keeps
-- NULL in all five — which is exactly "not an associate, no page grants".

-- Display name, and the first half of the login. NULL for everyone who signs in by email;
-- the worker falls back to the email address wherever a name is shown.
ALTER TABLE users ADD COLUMN name TEXT;

-- Hex HMAC-SHA256(PIN_PEPPER, code). NOT the code, and not a bare SHA-256 of it: a
-- six-digit number has a million candidates, so an unpeppered digest reverses in seconds
-- from a database dump. The pepper is a `wrangler secret`, so it is not in the dump at all.
ALTER TABLE users ADD COLUMN pin_hash TEXT;

-- Wrong codes in a row. Ten locks the account until an admin sets a new code; a correct
-- code resets it to zero. This is the rate limiter — a D1 UPDATE is atomic, where a KV
-- counter is eventually consistent and would not be one.
ALTER TABLE users ADD COLUMN pin_failures INTEGER NOT NULL DEFAULT 0;

-- Stamped by "Forgot your code?" on the login screen, cleared when the code is set. It is
-- the only thing that flow does — an associate cannot reset their own code, by design.
ALTER TABLE users ADD COLUMN pin_reset_requested_at TEXT;

-- JSON: {"bin-dump": "view"} or {"bin-dump": "edit"}. Absent key = cannot open the page.
--
-- 🔑 On `users`, not on `user_grants` next to `units`, which is where it belongs
-- conceptually. set-user-grants replaces a user's grants by DELETE + INSERT, so a grant
-- column would be silently wiped by an unrelated edit on the Users page. The grant row
-- still exists and still carries the stores; only the page list lives here.
ALTER TABLE users ADD COLUMN pages TEXT;
