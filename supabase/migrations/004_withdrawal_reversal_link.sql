-- ================================================================
-- MonieKing Contributors — Withdrawal Rejection Fix
-- Migration: 004_withdrawal_reversal_link.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001, 002, 003.
--
-- Problem this fixes: contribution_records get marked is_withdrawn=true
-- and the card's totals get debited the MOMENT a withdrawal is requested
-- (before a director even looks at it). But nothing linked a withdrawal
-- to exactly which records it touched, so rejecting a withdrawal had no
-- way to know what to undo — the money and the "red boxes" stayed gone
-- forever even though nothing was ever paid out.
--
-- This adds the missing link. See withdrawals.py's reject_withdrawal for
-- the actual reversal logic that uses it.
-- ================================================================

ALTER TABLE contribution_records
  ADD COLUMN IF NOT EXISTS withdrawal_id UUID REFERENCES withdrawals(id);

CREATE INDEX IF NOT EXISTS idx_contribution_records_withdrawal_id
  ON contribution_records(withdrawal_id);
