-- ================================================================
-- MonieKing Contributors
-- Migration: 011_indexing_audit.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001–010.
--
-- Findings from a full pass over every WHERE/ORDER BY pattern in the
-- backend against the indexes that already existed. Most of the schema
-- was already well-indexed (every foreign key used in a hot path had
-- one) — these are the specific gaps found:
--
-- 1. wallet_transactions: every wallet page load and every pagination
--    click runs `WHERE wallet_id = ? ORDER BY created_at DESC`. Only
--    wallet_id was indexed on its own, so Postgres had to filter then
--    sort separately. A composite index lets it do both in one pass —
--    this is the single hottest query in the whole app.
-- 2. notifications: same shape, `WHERE user_id = ? ORDER BY created_at
--    DESC`, and it's polled every 30s per active session (see
--    useAuth.ts) — same fix, same reasoning.
-- 3. contribution_cards: every card list (customer dashboard, officer
--    dashboard, card list pages) runs `WHERE owner_id = ? AND status =
--    'active'`. owner_id and status each had their own index but not
--    together.
-- 4. contribution_records.contributed_by, wallet_transactions.
--    initiated_by, broadcasts.sent_by: foreign keys with NO index at
--    all — currently only hit by the account-deletion eligibility
--    check (low frequency today), but an unindexed FK on a table that
--    only grows is exactly the kind of thing that's cheap to fix now
--    and expensive to notice later.
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_created
  ON wallet_transactions(wallet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cards_owner_status
  ON contribution_cards(owner_id, status);

CREATE INDEX IF NOT EXISTS idx_contribution_records_contributed_by
  ON contribution_records(contributed_by);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_initiated_by
  ON wallet_transactions(initiated_by);

CREATE INDEX IF NOT EXISTS idx_broadcasts_sent_by
  ON broadcasts(sent_by);
