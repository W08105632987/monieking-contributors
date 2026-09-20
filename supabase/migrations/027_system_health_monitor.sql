-- 027_system_health_monitor.sql
-- Backs the new system health monitor — a Celery-scheduled watchdog
-- (health_service.py, app/tasks/health_monitor.py) that checks
-- database latency, Redis, external provider reachability (Monnify,
-- Termii), transaction anomalies, and site traffic every few minutes,
-- and emails + SMS's the operator (ALERT_EMAIL_TO / ALERT_PHONE_TO in
-- settings — not tied to any user account) the moment something looks
-- wrong.

CREATE TABLE IF NOT EXISTS health_check_results (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_name  TEXT NOT NULL,          -- 'database' | 'redis' | 'monnify' | 'termii' | 'transactions' | 'traffic'
  status      TEXT NOT NULL,          -- 'healthy' | 'degraded' | 'down'
  message     TEXT,
  metrics     JSONB,                  -- e.g. {"latency_ms": 42} — whatever numbers the check itself produced, kept for the history/trend view
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_check_results_name_time ON health_check_results(check_name, checked_at DESC);

-- One row per check_name — tracks when an alert was last actually
-- sent for that check, so a check that stays down for an hour doesn't
-- SMS every single run (every 2-5 minutes); see
-- HEALTH_CHECK_ALERT_COOLDOWN_MINUTES in config.py.
CREATE TABLE IF NOT EXISTS health_alert_state (
  check_name       TEXT PRIMARY KEY,
  last_status      TEXT NOT NULL,
  last_alerted_at  TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE health_check_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_alert_state   ENABLE ROW LEVEL SECURITY;

-- Admin/director only — same audience as every other operational/CRM
-- table added this project. Nothing here is customer data, but it IS
-- operational detail about the platform's infrastructure that has no
-- reason to be readable more broadly.
CREATE POLICY "health_check_results_select" ON health_check_results FOR SELECT USING (
  current_user_role() IN ('admin', 'director')
);
CREATE POLICY "health_alert_state_select" ON health_alert_state FOR SELECT USING (
  current_user_role() IN ('admin', 'director')
);
