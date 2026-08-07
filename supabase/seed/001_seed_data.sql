-- ================================================================
-- MonieKing Contributors — Development Seed Data
-- Run ONLY in development/staging environment
-- ================================================================

-- Default zones
INSERT INTO zones (id, name, description) VALUES
  (uuid_generate_v4(), 'Lagos Island',   'Lagos Island zone — primary urban zone'),
  (uuid_generate_v4(), 'Lagos Mainland', 'Lagos Mainland zone'),
  (uuid_generate_v4(), 'Abuja Central',  'Abuja FCT central zone'),
  (uuid_generate_v4(), 'Port Harcourt',  'Rivers State zone')
ON CONFLICT (name) DO NOTHING;

-- Default system config (ensure defaults exist)
INSERT INTO system_config (key, value, description) VALUES
  ('max_food_cards_per_customer',       '2',       'Max Food Cards per customer'),
  ('withdrawal_sla_hours',              '24',      'Withdrawal processing SLA'),
  ('min_regular_card_rate_kobo',        '50000',   'Min Regular Card rate (₦500)'),
  ('large_contribution_threshold_kobo', '5000000', 'Large contribution threshold (₦50,000)')
ON CONFLICT (key) DO NOTHING;
