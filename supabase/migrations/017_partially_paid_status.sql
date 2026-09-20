-- ================================================================
-- MonieKing Contributors
-- Migration: 017_partially_paid_status.sql
--
-- Adds 'partially_paid' to the card_completion_status enum.
--
-- Context: completed cards were meant to show three states (paid,
-- unpaid, partially paid) but the code path that flips a card to
-- 'paid' after a withdrawal was actually dead — it checked for a
-- 'withdrawal_pending' state that nothing ever set, so every
-- completed card stayed stuck on 'unpaid' regardless of how many
-- withdrawals were made and paid out. Fixed in card_service.py
-- (recompute_card_completion_status) alongside this migration.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to run as its own
-- statement, not combined with other DDL in the same transaction
-- block. Run this on its own in Supabase's SQL Editor.
-- ================================================================

ALTER TYPE card_completion_status ADD VALUE IF NOT EXISTS 'partially_paid';
