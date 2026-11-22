-- 073: Director switch for alert EMAILS (Alerts page > "Email alerts" button).
--
-- Alerts are still recorded and shown in the director portal either way, and critical SMS is not affected.
-- Seeded OFF so the stream of alert emails stops as soon as this is deployed; a director turns it back on from the
-- Alerts page whenever they want. Safe to run more than once, and it never overwrites a choice a director already made.
--
-- Rollback: DELETE FROM system_config WHERE key = 'alerts.email_enabled';   (the code treats a missing row as OFF)

INSERT INTO system_config (key, value, description)
VALUES ('alerts.email_enabled', 'false',
        'Send system alerts by email. Alerts always show in the director portal; critical alerts are still texted. Switch it on the Alerts page.')
ON CONFLICT (key) DO NOTHING;
