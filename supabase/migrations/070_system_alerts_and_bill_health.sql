-- 070: alert history (one row per incident, de-duplicated) and the bill-health settings.
CREATE TABLE IF NOT EXISTS system_alerts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    severity         VARCHAR(10)  NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    category         VARCHAR(30)  NOT NULL,            -- provider | infra | database | data_integrity | fraud | security | logs | messaging | bills | health
    title            VARCHAR(200) NOT NULL,
    detail           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key       VARCHAR(200) NOT NULL,            -- same incident = same key, so repeats are counted, not re-sent every minute
    occurrences      INTEGER      NOT NULL DEFAULT 1,
    status           VARCHAR(14)  NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    emailed_at       TIMESTAMPTZ,
    email_ok         BOOLEAN,
    sms_at           TIMESTAMPTZ,
    acknowledged_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at  TIMESTAMPTZ,
    resolved_at      TIMESTAMPTZ
);
-- At most one UNRESOLVED incident per key; a resolved one makes room for a new incident with the same key.
CREATE UNIQUE INDEX IF NOT EXISTS ux_system_alerts_open_key ON system_alerts (dedupe_key) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS ix_system_alerts_status_seen ON system_alerts (status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS ix_system_alerts_created ON system_alerts (created_at DESC);

-- Bill success-rate queries group recent requests by biller.
CREATE INDEX IF NOT EXISTS ix_bill_requests_biller_created ON bill_payment_requests (biller_id, created_at DESC);

INSERT INTO system_config (key, value, description) VALUES
  ('bill_warning_threshold_percent', '30',  'Below this success rate (%), customers see a warning before paying that biller'),
  ('bill_health_min_attempts',       '5',   'A biller needs at least this many recent purchases before its success rate is trusted'),
  ('bill_health_window_minutes',     '180', 'How far back (minutes) purchases count toward a biller''s success rate')
ON CONFLICT (key) DO NOTHING;
