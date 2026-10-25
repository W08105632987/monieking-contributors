-- 053: NIN-only KYC page: optional phone check + name on the virtual account. Additive, idempotent.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS virtual_account_name VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_otp_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_otp_attempts INTEGER NOT NULL DEFAULT 0;
