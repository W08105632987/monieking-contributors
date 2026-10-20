-- 048: Cooperative withdrawals paid by a director (Module A). Additive, idempotent.
CREATE TABLE IF NOT EXISTS coop_withdrawals (
    id             UUID PRIMARY KEY,
    member_id      UUID NOT NULL REFERENCES coop_members(id),
    amount_kobo    BIGINT NOT NULL CHECK (amount_kobo > 0),
    charge_kobo    BIGINT NOT NULL DEFAULT 0,
    net_kobo       BIGINT NOT NULL,
    charge_bps     INTEGER NOT NULL DEFAULT 0,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending',   -- pending | paid | rejected | cancelled
    payout_account JSONB,
    hold_reason    VARCHAR(300),
    reference      VARCHAR(120),
    evidence       TEXT,
    reason         TEXT,
    decided_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_coop_withdrawals_member ON coop_withdrawals(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_coop_withdrawals_status ON coop_withdrawals(status);
