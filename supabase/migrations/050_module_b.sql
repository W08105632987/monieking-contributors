-- 050: notifications remember the page they open (Module B). Additive, idempotent.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;

-- Card "days left" repair: older withdrawal code decremented total_days_contributed,
-- so fully filled cards could show e.g. "32 days left". Records are never deleted
-- (withdrawn ones are only flagged), so the true count is the number of records.
UPDATE contribution_cards c
   SET total_days_contributed = r.n
  FROM (SELECT card_id, COUNT(*) AS n FROM contribution_records GROUP BY card_id) r
 WHERE r.card_id = c.id AND c.total_days_contributed <> r.n;

-- SMS overhaul: per-SMS fee (replaces the monthly subscription charge).
-- Customers managed by an officer have no wallet, so their SMS charges pile up
-- here and come off the card at withdrawal together with the normal charge.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_accrued_kobo BIGINT NOT NULL DEFAULT 0;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS sms_charge_kobo BIGINT NOT NULL DEFAULT 0;
INSERT INTO system_config (key, value, description, updated_at) VALUES
  ('sms_fee_per_sms_kobo', '500', 'Fee charged per SMS segment to customers who opted into SMS alerts, in kobo (500 = N5). Set by directors.', NOW()),
  ('sms_provider_cost_per_segment_kobo', '400', 'What the SMS provider charges us per segment, in kobo. Used only to show directors the cost of bulk sends.', NOW())
ON CONFLICT (key) DO NOTHING;

-- Food cards: remember when the package was collected, so the card says "Collected" instead of "Unpaid".
ALTER TABLE contribution_cards ADD COLUMN IF NOT EXISTS food_collected_at TIMESTAMPTZ;
UPDATE contribution_cards c SET food_collected_at = e.collected_at
  FROM food_entitlements e
 WHERE e.card_id = c.id AND e.status = 'used' AND e.collected_at IS NOT NULL AND c.food_collected_at IS NULL;
