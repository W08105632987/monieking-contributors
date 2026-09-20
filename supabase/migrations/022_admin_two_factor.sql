-- 022_admin_two_factor.sql
-- Backs the admin CRM's mandatory 2FA login (every login, not just
-- first device) — see auth_admin.py. Deliberately separate columns
-- from login_password_reset_otp_hash/_expires_at (010_login_lockout.sql):
-- that pair is for the "forgot password" flow, this pair is for the
-- second factor on an already-correct password. Sharing one pair
-- between two different flows would let one silently invalidate the
-- other mid-flow (e.g. requesting a password reset while a 2FA code is
-- still pending would stomp it).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_factor_otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS two_factor_otp_expires_at TIMESTAMPTZ;
