-- Migration 043: Real push notifications (Web Push / VAPID)
--
-- A user can have several active subscriptions (phone + desktop at once),
-- so this is its own table, not a column on users. No FCM/APNs account or
-- payment required — VAPID is a free, open standard; the browser's own
-- underlying push service delivers the signed payload.

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint     TEXT NOT NULL UNIQUE,
    p256dh_key   TEXT NOT NULL,
    auth_key     TEXT NOT NULL,
    user_agent   TEXT,              -- e.g. "Chrome on Windows", "Safari on iPhone" — for the device-management list
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON push_subscriptions (user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_bypass_push_subscriptions"
    ON push_subscriptions FOR ALL TO service_role USING (TRUE);
