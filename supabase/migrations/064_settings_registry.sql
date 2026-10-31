-- 062: Business Settings overhaul.
--  * Hour-based settings become minute-based so directors can set hours AND minutes (no decimals).
--    Existing values are carried over (hours x 60); nothing changes behaviour on deploy.
--  * min_regular_card_rate_kobo is now actually enforced. It is set to the floor that has always been
--    enforced in code (₦50) so no customer is affected until a director raises it. (It was seeded as ₦500
--    but never read, so ₦500 would have been a silent change.)
--  * max_manual_credit_kobo is new: default ₦5,000,000, the cap that used to be hard-coded.

INSERT INTO system_config (key, value, description)
SELECT 'dispute_sla_minutes', (value::int * 60)::text, 'Minutes an unresolved dispute can wait before it is escalated to the director queue'
FROM system_config WHERE key = 'dispute_sla_hours' AND value ~ '^[0-9]+$'
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (key, value, description)
SELECT 'dispute_eligibility_window_minutes', (value::int * 60)::text, 'Minutes after completion during which a customer can still raise a commission dispute'
FROM system_config WHERE key = 'dispute_eligibility_window_hours' AND value ~ '^[0-9]+$'
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (key, value, description)
SELECT 'withdrawal_sla_minutes', (value::int * 60)::text, 'Minutes a withdrawal should take to process; pending ones older than this are flagged by the health check'
FROM system_config WHERE key = 'withdrawal_sla_hours' AND value ~ '^[0-9]+$'
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (key, value, description)
SELECT 'verification.retention_minutes', (value::int * 60)::text, 'Minutes a NIN/BVN lookup result is kept before the personal details are wiped'
FROM system_config WHERE key = 'verification.retention_hours' AND value ~ '^[0-9]+$'
ON CONFLICT (key) DO NOTHING;

-- Defaults for anything that had no old value to carry over.
INSERT INTO system_config (key, value, description) VALUES
  ('dispute_sla_minutes',                '2880',      'Minutes an unresolved dispute can wait before it is escalated to the director queue'),
  ('dispute_eligibility_window_minutes', '4320',      'Minutes after completion during which a customer can still raise a commission dispute'),
  ('withdrawal_sla_minutes',             '1440',      'Minutes a withdrawal should take to process; pending ones older than this are flagged by the health check'),
  ('max_manual_credit_kobo',             '500000000', 'Largest single manual credit a director can make to one account, in kobo (default ₦5,000,000)')
ON CONFLICT (key) DO NOTHING;

-- Old hour keys are no longer read by anything. Remove them so two values can never disagree.
DELETE FROM system_config WHERE key IN ('dispute_sla_hours', 'dispute_eligibility_window_hours', 'withdrawal_sla_hours', 'verification.retention_hours');

-- Enforce the floor that was always enforced in code.
UPDATE system_config SET value = '5000',
  description = 'Lowest daily rate a customer can choose for a Regular Card, in kobo (minimum ₦50, multiples of ₦50)'
WHERE key = 'min_regular_card_rate_kobo';
INSERT INTO system_config (key, value, description) VALUES
  ('min_regular_card_rate_kobo', '5000', 'Lowest daily rate a customer can choose for a Regular Card, in kobo (minimum ₦50, multiples of ₦50)')
ON CONFLICT (key) DO NOTHING;
