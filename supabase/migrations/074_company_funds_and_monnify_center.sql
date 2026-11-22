-- 074: company-funds balancing (day closings + transfer log + counted balances) and Monnify center settings.
-- Safe to re-run. Rollback: DROP TABLE day_closings, fund_transfers, fund_account_balances; DELETE the system_config keys below.

CREATE TABLE IF NOT EXISTS fund_transfers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_on   DATE        NOT NULL,
    kind          VARCHAR(12) NOT NULL CHECK (kind IN ('transfer', 'injection', 'drawing', 'goodwill')),
    from_account  VARCHAR(20),
    to_account    VARCHAR(20),
    amount_kobo   BIGINT      NOT NULL CHECK (amount_kobo > 0),
    fee_kobo      BIGINT      NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
    reference     VARCHAR(120),
    note          VARCHAR(300),
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    voided_at     TIMESTAMPTZ,
    voided_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    void_reason   VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS ix_fund_transfers_day ON fund_transfers (occurred_on);

CREATE TABLE IF NOT EXISTS fund_account_balances (
    account       VARCHAR(20) PRIMARY KEY,
    counted_kobo  BIGINT      NOT NULL,
    counted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    counted_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS day_closings (
    day                  DATE PRIMARY KEY,
    closed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    auto_closed          BOOLEAN     NOT NULL DEFAULT FALSE,
    opening_capital_kobo BIGINT      NOT NULL,
    profit_kobo          BIGINT      NOT NULL,
    injections_kobo      BIGINT      NOT NULL DEFAULT 0,
    drawings_kobo        BIGINT      NOT NULL DEFAULT 0,
    goodwill_kobo        BIGINT      NOT NULL DEFAULT 0,
    transfer_fees_kobo   BIGINT      NOT NULL DEFAULT 0,
    closing_capital_kobo BIGINT      NOT NULL,
    obligations_kobo     BIGINT      NOT NULL,
    expected_total_kobo  BIGINT      NOT NULL,
    actual_total_kobo    BIGINT      NOT NULL,
    difference_kobo      BIGINT      NOT NULL,
    snapshot             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    note                 VARCHAR(300)
);

INSERT INTO system_config (key, value, description) VALUES
  ('cash.auto_close_enabled',      'false', 'Close each business day automatically at the set time'),
  ('cash.auto_close_time',         '23:55', 'Time (Nigeria time, HH:MM) the day closes automatically'),
  ('cash.opening_capital_kobo',    '',      'Company capital before the first closed day (kobo)'),
  ('monnify.low_warning_naira',    '',      'Warn when the Monnify wallet falls below this (blank = use MONNIFY_MIN_WALLET_NAIRA)'),
  ('monnify.low_critical_naira',   '',      'Critical alert when the Monnify wallet falls below this (blank = a quarter of the warning level)'),
  ('monnify.settlement_days',      '1',     'Business days Monnify takes to settle a payment into the Monnify wallet'),
  ('monnify.late_settlement_alerts','true', 'Alert when a payment is still unsettled after its expected settlement day')
ON CONFLICT (key) DO NOTHING;
INSERT INTO system_config (key, value, description) VALUES
  ('cash.opening_capital_date', '', 'Date (YYYY-MM-DD) the opening capital figure applies to the start of')
ON CONFLICT (key) DO NOTHING;
