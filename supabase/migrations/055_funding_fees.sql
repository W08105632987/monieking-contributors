-- 055: director-controlled wallet funding fee + funding records (loss tracking & stats). Additive, idempotent.
CREATE TABLE IF NOT EXISTS funding_fee_settings (
    id               INTEGER PRIMARY KEY DEFAULT 1,
    charge_customers BOOLEAN NOT NULL DEFAULT FALSE,
    pass_monnify_fee BOOLEAN NOT NULL DEFAULT FALSE,
    tiers            JSONB NOT NULL,
    updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT funding_fee_settings_single CHECK (id = 1)
);
ALTER TABLE funding_fee_settings ADD COLUMN IF NOT EXISTS pass_monnify_fee BOOLEAN NOT NULL DEFAULT FALSE;
INSERT INTO funding_fee_settings (id, charge_customers, tiers) VALUES (1, FALSE,
 '[{"from":0,"to":5000,"fee":10},{"from":5001,"to":10000,"fee":20},{"from":10001,"to":20000,"fee":30},{"from":20001,"to":null,"fee":50}]'::jsonb)
ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS funding_records (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference          VARCHAR(200) NOT NULL UNIQUE,
    wallet_id          UUID REFERENCES wallets(id) ON DELETE SET NULL,
    user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
    gross_kobo         BIGINT NOT NULL,
    customer_fee_kobo  BIGINT NOT NULL DEFAULT 0,
    credited_kobo      BIGINT NOT NULL,
    monnify_fee_kobo   BIGINT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_funding_records_created ON funding_records (created_at);
