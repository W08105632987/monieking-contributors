-- 057: Accounting Center (director-only). Additive and idempotent.
-- cost_rates: what outside providers charge us. Directors type these in; nothing is hard-coded.
--   Rows are never edited: a new price is a new row with its own effective_from, so old periods keep the price that applied then.
-- expenses: money the company spent that the system cannot see by itself. Directors add, edit and delete freely (no month lock).
-- provider_usage: one row per provider call we cannot count from another table (SMS sent, etc.).

CREATE TABLE IF NOT EXISTS cost_rates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rate_key        VARCHAR(120) NOT NULL,
    mode            VARCHAR(10)  NOT NULL DEFAULT 'flat',      -- flat = kobo per event, percent = basis points of the amount
    value           NUMERIC(14,2) NOT NULL DEFAULT 0,
    cap_kobo        BIGINT,                                    -- optional ceiling per event (percent mode)
    effective_from  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    note            VARCHAR(300),
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT cost_rates_mode_chk CHECK (mode IN ('flat', 'percent')),
    CONSTRAINT cost_rates_value_chk CHECK (value >= 0)
);
CREATE INDEX IF NOT EXISTS ix_cost_rates_key_eff ON cost_rates (rate_key, effective_from DESC);

CREATE TABLE IF NOT EXISTS expenses (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spent_on      DATE         NOT NULL,
    category      VARCHAR(60)  NOT NULL,
    description   VARCHAR(300) NOT NULL,
    amount_kobo   BIGINT       NOT NULL,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT expenses_amount_chk CHECK (amount_kobo > 0)
);
CREATE INDEX IF NOT EXISTS ix_expenses_spent_on ON expenses (spent_on);

CREATE TABLE IF NOT EXISTS provider_usage (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rate_key    VARCHAR(120) NOT NULL,
    quantity    INTEGER      NOT NULL DEFAULT 1,
    ok          BOOLEAN      NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_provider_usage_key_time ON provider_usage (rate_key, created_at);

-- Director's cash-buffer setting lives in system_config-free form: a single settings row.
CREATE TABLE IF NOT EXISTS accounting_settings (
    id           INTEGER PRIMARY KEY DEFAULT 1,
    buffer_days  INTEGER NOT NULL DEFAULT 14,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT accounting_settings_one CHECK (id = 1)
);
INSERT INTO accounting_settings (id, buffer_days) VALUES (1, 14) ON CONFLICT (id) DO NOTHING;
