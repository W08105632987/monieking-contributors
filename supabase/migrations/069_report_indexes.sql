-- 069: indexes for the zone customer overview, food conversion and dashboard date ranges. Idempotent.
CREATE INDEX IF NOT EXISTS idx_users_zone_created ON users (zone_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cards_type_status  ON contribution_cards (card_type, status);
CREATE INDEX IF NOT EXISTS idx_contrib_records_created ON contribution_records (created_at DESC);
