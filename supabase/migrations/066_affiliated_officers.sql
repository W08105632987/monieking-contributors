-- 064: Affiliated (commission) officers.
--  officer_type: 'salary' (as before) | 'affiliated' (earns a % of the company's profit on each withdrawal). NULL on an officer =
--  not classified yet; the director is asked to choose.
--  commission_officer_id on a CUSTOMER = the one officer who earns commission on that customer's withdrawals (director controls it).
ALTER TABLE users ADD COLUMN IF NOT EXISTS officer_type VARCHAR(12) CHECK (officer_type IN ('salary', 'affiliated'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS officer_commission_percent SMALLINT CHECK (officer_commission_percent BETWEEN 0 AND 100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS officer_welcome_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_officer_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_users_commission_officer ON users (commission_officer_id) WHERE commission_officer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS officer_commissions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    officer_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    withdrawal_id      UUID NOT NULL UNIQUE REFERENCES withdrawals(id) ON DELETE CASCADE,   -- one commission per withdrawal
    company_charge_kobo BIGINT NOT NULL,      -- what the company collected on that withdrawal (one card rate per month)
    percent            SMALLINT NOT NULL,     -- the % in force when it was earned
    amount_kobo        BIGINT NOT NULL,       -- the officer's share
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_officer_commissions_officer ON officer_commissions (officer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS officer_payouts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    officer_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_kobo    BIGINT NOT NULL CHECK (amount_kobo > 0),
    bank_name      VARCHAR(100) NOT NULL,   -- the details travel WITH the request, like a customer withdrawal
    account_number VARCHAR(20)  NOT NULL,
    account_name   VARCHAR(200) NOT NULL,
    status         VARCHAR(10)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected')),
    rejection_reason TEXT,
    processed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_officer_payouts_status ON officer_payouts (status, requested_at);
CREATE INDEX IF NOT EXISTS ix_officer_payouts_officer ON officer_payouts (officer_id, requested_at DESC);

INSERT INTO system_config (key, value, description) VALUES
  ('affiliated_officer_commission_percent', '30', 'Share (%) of the company profit on each paid withdrawal that goes to the customer''s commission officer')
ON CONFLICT (key) DO NOTHING;
