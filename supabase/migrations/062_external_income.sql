-- 062: money earned OUTSIDE the app (other businesses, one-off deals), entered by the director in the Accounting Center.
-- Additive, safe to re-run. Same lock-down as migration 061: the public API key can never touch it.
CREATE TABLE IF NOT EXISTS external_income (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  earned_on    DATE         NOT NULL,
  source       VARCHAR(60)  NOT NULL,
  description  VARCHAR(300) NOT NULL,
  amount_kobo  BIGINT       NOT NULL CHECK (amount_kobo > 0),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_external_income_earned_on ON external_income (earned_on);
ALTER TABLE external_income ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE external_income FROM anon;
