-- 026_analytics_events.sql
-- Backs the new in-app "live metrics" dashboard (admin CRM + director
-- portal) — a self-hosted, privacy-respecting alternative to embedding
-- a third-party analytics script. Self-hosted is the deliberate choice
-- here, not just the cheap one: a fintech app's page-view/click stream
-- inherently reveals which customers/officers are active and when,
-- which is exactly the kind of data that shouldn't leave your own
-- infrastructure and go to a third party by default.

CREATE TABLE IF NOT EXISTS analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL,          -- 'pageview' | 'click'
  path        TEXT NOT NULL,          -- the route path, e.g. '/officer/dashboard'
  label       TEXT,                   -- for clicks: a readable label for what was clicked
  session_id  TEXT NOT NULL,          -- client-generated, persisted in localStorage — groups events into a "visit" without needing a login
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,   -- null for logged-out visits (e.g. the public landing page, the login screen itself)
  role        TEXT,                   -- role at time of event, denormalized so historical charts don't change if a user's role changes later
  referrer    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The two query shapes the dashboard actually needs: "what happened
-- recently" (time-series charts) and "what's the most-visited/clicked
-- thing" (top-N lists), both usually also filtered by event_type.
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_path  ON analytics_events(event_type, path);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session    ON analytics_events(session_id);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Only admin/director can ever read this back — matches who the two
-- dashboards consuming it are restricted to. No one can read another
-- user's individual click stream, including officers/customers reading
-- their own — this table is for aggregate platform metrics, not
-- something any end user has a reason to query directly.
CREATE POLICY "analytics_events_select" ON analytics_events FOR SELECT USING (
  current_user_role() IN ('admin', 'director')
);

-- Insert is intentionally open to anyone with a valid session (even
-- logged out, for pre-auth pages like the landing page and login
-- screen) — the write path is a track-only, fire-and-forget beacon,
-- never used to grant read access to anything.
CREATE POLICY "analytics_events_insert" ON analytics_events FOR INSERT WITH CHECK (true);
