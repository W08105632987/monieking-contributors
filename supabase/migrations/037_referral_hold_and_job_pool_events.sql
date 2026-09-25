-- =============================================================================
-- 037 · Service Worker Referral Hold & Job Pool Events Audit Log
-- =============================================================================

-- ─── 1. System config for referral hold window (minutes) ────────────────────
INSERT INTO system_config (key, value, description)
VALUES
  ('service_worker_referral_hold_minutes', '30', 'Minutes a referred manual service request is exclusively held for the referred worker before entering the general pool')
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Job pool events table for audit & metrics ───────────────────────────
CREATE TABLE IF NOT EXISTS job_pool_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES manual_service_requests(id) ON DELETE CASCADE,
  event_type  VARCHAR(50) NOT NULL, -- 'claimed', 'resolved', 'sla_reclaimed', 'referral_expired'
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_job_pool_events_job_id
  ON job_pool_events (job_id);

CREATE INDEX IF NOT EXISTS idx_job_pool_events_event_type_created_at
  ON job_pool_events (event_type, created_at);

-- ─── 4. Row Level Security ──────────────────────────────────────────────────
ALTER TABLE job_pool_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_bypass_job_pool_events"
  ON job_pool_events FOR ALL TO service_role USING (TRUE);
