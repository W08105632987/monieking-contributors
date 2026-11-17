-- 072: Airtime to Cash. A customer sends airtime from their own line; we credit their wallet.
-- The customer's SIM transfer PIN and the one-time code are NEVER stored (they pass through to the supplier and are discarded).
ALTER TYPE tx_category ADD VALUE IF NOT EXISTS 'airtime_cash';

CREATE TABLE IF NOT EXISTS airtime_cash_requests (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    network               VARCHAR(12) NOT NULL,            -- MTN | Airtel | Glo | 9mobile
    phone                 VARCHAR(20) NOT NULL,            -- the line the airtime is taken from
    amount_kobo           BIGINT NOT NULL CHECK (amount_kobo > 0),          -- airtime the customer is selling
    provider_credit_kobo  BIGINT NOT NULL DEFAULT 0,       -- what the supplier credits US for it (their rate)
    payout_kobo           BIGINT NOT NULL DEFAULT 0,       -- what the CUSTOMER receives in their wallet
    fee_kobo              BIGINT NOT NULL DEFAULT 0,       -- our margin = provider_credit - payout
    status                VARCHAR(16) NOT NULL DEFAULT 'started'
        CHECK (status IN ('started', 'otp_sent', 'verified', 'submitted', 'completed', 'failed', 'pending_review', 'rejected')),
    provider_identifier   VARCHAR(120),                    -- supplier's short-lived ids for this attempt (not customer secrets)
    provider_session      VARCHAR(160),
    provider_reference    VARCHAR(120),
    failure_reason        TEXT,
    reviewed_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_a2c_customer_created ON airtime_cash_requests (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_a2c_status ON airtime_cash_requests (status, created_at);
