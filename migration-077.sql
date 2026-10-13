-- migration-077: count wrong guesses of the emailed sign-in code (2026-10-13).
-- auth-verify-otp claims one attempt per guess and refuses a code once it reaches 5,
-- so the 6-digit code cannot be guessed in its 15 minutes. Additive; the previous
-- worker ignores the column, so this runs BEFORE the worker deploy.
ALTER TABLE magic_links ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0;
