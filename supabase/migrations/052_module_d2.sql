-- 052: Module D2 — optional email (with verification code) for every account. Additive, idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email VARCHAR(254);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_code_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_code_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_code_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_attempts INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (LOWER(email)) WHERE email IS NOT NULL AND email_verified_at IS NOT NULL;
