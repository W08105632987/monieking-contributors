-- ================================================================
-- MonieKing Contributors
-- Migration: 018_service_notify_requests.sql
--
-- One row per customer who taps "Notify Me" on a Coming Soon
-- service. Deduped per (service_id, customer_id) so repeat taps
-- don't inflate demand numbers — the count itself is the signal
-- for which manual/gated services to prioritize building.
-- ================================================================

CREATE TABLE IF NOT EXISTS identity_service_notify_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES identity_services(id),
  customer_id  UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_notify_requests_service
  ON identity_service_notify_requests (service_id);

ALTER TABLE identity_service_notify_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notify_requests_select" ON identity_service_notify_requests FOR SELECT USING (
  customer_id = auth.uid() OR current_user_role() IN ('officer', 'admin', 'director')
);

CREATE POLICY "notify_requests_insert" ON identity_service_notify_requests FOR INSERT WITH CHECK (
  customer_id = auth.uid()
);
