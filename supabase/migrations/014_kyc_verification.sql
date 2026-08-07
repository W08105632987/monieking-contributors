-- ================================================================
-- MonieKing Contributors
-- Migration: 014_kyc_verification.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001–013.
--
-- CBN mandates that every Monnify reserved (virtual) account be
-- linked to a BVN and/or NIN. We deliberately do NOT store the raw
-- BVN/NIN here — only whether each has been linked, and the last 4
-- digits for the user's own reference on screen. The actual numbers
-- are sent straight to Monnify at verification time and never
-- persisted on our side.
--
-- Reserved-account creation is now GATED on this: a wallet only gets
-- a virtual_account_number once at least one of bvn_linked /
-- nin_linked is true (see wallets.py — provision_my_virtual_account).
-- ================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bvn_linked   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nin_linked   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bvn_last4    VARCHAR(4),
  ADD COLUMN IF NOT EXISTS nin_last4    VARCHAR(4),
  ADD COLUMN IF NOT EXISTS kyc_completed_at TIMESTAMPTZ;
