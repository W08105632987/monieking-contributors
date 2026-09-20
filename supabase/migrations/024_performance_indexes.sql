-- 024_performance_indexes.sql
-- Found while checking query performance ahead of launch: the
-- active/inactive-contributor aggregates (customer_stats_service.py)
-- and the officer's last-contribution lookups both filter/scan
-- contribution_records on columns that weren't indexed for this access
-- pattern specifically. Existing indexes cover card_id alone and
-- (card_id, logical_month, logical_day) — neither serves "does this
-- card have any record where is_withdrawn = false" or "most recent
-- created_at per card" efficiently at real scale.

-- Partial index: only unwithdrawn records need to be found fast, and
-- there are far fewer of those over time than the full history (every
-- withdrawn record stays in the table forever) — a partial index stays
-- small and fast even as total row count grows.
CREATE INDEX IF NOT EXISTS idx_contrib_records_unwithdrawn
  ON contribution_records(card_id)
  WHERE is_withdrawn = false;

-- Serves the "last contribution date per card" lookup (officer-side
-- inactivity badge, and the reconciliation/customer-stats work).
CREATE INDEX IF NOT EXISTS idx_contrib_records_card_created
  ON contribution_records(card_id, created_at DESC);
