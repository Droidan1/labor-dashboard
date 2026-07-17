-- migration-006: Add OTP code column to magic_links for PWA auth
ALTER TABLE magic_links ADD COLUMN otp_code TEXT;
CREATE INDEX IF NOT EXISTS idx_magic_links_otp ON magic_links(otp_code);
