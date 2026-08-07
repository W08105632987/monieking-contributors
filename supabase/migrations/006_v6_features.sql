-- ================================================================
-- MonieKing Contributors — v6 feature batch
-- Migration: 006_v6_features.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001–005.
-- Covers: real WebAuthn (fixes the fake-biometric security hole),
-- profile avatars, withdrawal-password brute-force lockout, forgot-
-- password OTP, and the new business settings.
-- ================================================================

-- ── WebAuthn credentials ─────────────────────────────────────────
CREATE TABLE webauthn_credentials (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id  BYTEA NOT NULL UNIQUE,
  public_key     BYTEA NOT NULL,
  sign_count     INT NOT NULL DEFAULT 0,
  nickname       TEXT NOT NULL DEFAULT 'Biometric login',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ
);
CREATE INDEX idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS webauthn_challenge             TEXT,
  ADD COLUMN IF NOT EXISTS webauthn_challenge_expires_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS avatar_url                      TEXT,
  ADD COLUMN IF NOT EXISTS withdrawal_password_failed_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withdrawal_password_locked_until    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS login_password_reset_otp_hash        TEXT,
  ADD COLUMN IF NOT EXISTS login_password_reset_otp_expires_at  TIMESTAMPTZ;

-- ── Storage bucket for profile avatars ──────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone authenticated can upload/update their own avatar; public read
-- (bucket is public, so reads don't need a policy, but writes do)
CREATE POLICY avatars_upload_own ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');
CREATE POLICY avatars_update_own ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

-- ── New business settings ───────────────────────────────────────
INSERT INTO system_config (key, value, description) VALUES
  ('max_instant_withdrawal_kobo', '5000000', 'Maximum a customer can withdraw via instant wallet withdrawal per day, in kobo. Default ₦50,000. Card withdrawals are not subject to this cap.')
ON CONFLICT (key) DO NOTHING;
