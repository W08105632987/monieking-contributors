-- Migration 047: MonieKing Cooperative completion (Modules 10b-10e)
-- Additive and idempotent. Only coop_* tables are created or altered. No wallet or other table is touched.

-- members: fee, next of kin, death flag
ALTER TABLE coop_members ADD COLUMN IF NOT EXISTS fee_paid_at      TIMESTAMPTZ;
ALTER TABLE coop_members ADD COLUMN IF NOT EXISTS next_of_kin      JSONB;
ALTER TABLE coop_members ADD COLUMN IF NOT EXISTS death_flagged_at TIMESTAMPTZ;

-- loans: offer, payout, clock, repayment, write-off
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS offer_fee_kobo      BIGINT NOT NULL DEFAULT 0;
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS net_payout_kobo     BIGINT NOT NULL DEFAULT 0;
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS offer_expires_at    TIMESTAMPTZ;
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS accepted_at         TIMESTAMPTZ;
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS payout_status       VARCHAR(20);
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS payout_ref          VARCHAR(120);
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS payout_evidence     TEXT;
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS payout_by           UUID;
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS paid_out_at         TIMESTAMPTZ;
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS payout_account      JSONB;
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS payout_hold_reason  VARCHAR(300);
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS repay_source        VARCHAR(20) NOT NULL DEFAULT 'contribution_auto';
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS final_due_rule      VARCHAR(30) NOT NULL DEFAULT 'after_final_due_date';
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS clock_rule          VARCHAR(20) NOT NULL DEFAULT 'payout';
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS written_off_kobo    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS waived_kobo         BIGINT NOT NULL DEFAULT 0;
ALTER TABLE coop_loans ADD COLUMN IF NOT EXISTS restructured_count  INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS coop_member_bank (
    member_id      UUID PRIMARY KEY REFERENCES coop_members(id) ON DELETE CASCADE,
    bank_code      VARCHAR(20) NOT NULL,
    bank_name      VARCHAR(100),
    account_number VARCHAR(20) NOT NULL,
    account_name   VARCHAR(200) NOT NULL,
    name_match     BOOLEAN NOT NULL DEFAULT FALSE,
    name_note      VARCHAR(200),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one generic request that needs director votes (final release, waiver, restructure, write-off, expense, ...)
CREATE TABLE IF NOT EXISTS coop_requests (
    id          UUID PRIMARY KEY,
    kind        VARCHAR(30) NOT NULL,
    member_id   UUID REFERENCES coop_members(id),
    loan_id     UUID REFERENCES coop_loans(id),
    ref_id      VARCHAR(60),
    amount_kobo BIGINT NOT NULL DEFAULT 0,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason      TEXT,
    evidence    TEXT,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    needed      INTEGER NOT NULL DEFAULT 2,
    consents    JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at  TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    result      JSONB
);
CREATE INDEX IF NOT EXISTS coop_requests_status_idx ON coop_requests(status, kind);
CREATE INDEX IF NOT EXISTS coop_requests_loan_idx ON coop_requests(loan_id);

CREATE TABLE IF NOT EXISTS coop_request_votes (
    id          UUID PRIMARY KEY,
    request_id  UUID NOT NULL REFERENCES coop_requests(id) ON DELETE CASCADE,
    director_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision    VARCHAR(10) NOT NULL,
    note        VARCHAR(300),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT coop_request_votes_uq UNIQUE (request_id, director_id)
);

CREATE TABLE IF NOT EXISTS coop_cases (
    id          UUID PRIMARY KEY,
    kind        VARCHAR(20) NOT NULL,
    member_id   UUID REFERENCES coop_members(id),
    loan_id     UUID REFERENCES coop_loans(id),
    status      VARCHAR(20) NOT NULL DEFAULT 'open',
    subject     VARCHAR(200) NOT NULL,
    body        TEXT,
    category    VARCHAR(40),
    opened_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    opened_auto BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_at      TIMESTAMPTZ,
    closed_at   TIMESTAMPTZ,
    resolution  TEXT
);
CREATE INDEX IF NOT EXISTS coop_cases_kind_idx ON coop_cases(kind, status);

CREATE TABLE IF NOT EXISTS coop_case_notes (
    id         UUID PRIMARY KEY,
    case_id    UUID NOT NULL REFERENCES coop_cases(id) ON DELETE CASCADE,
    author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    kind       VARCHAR(30) NOT NULL DEFAULT 'note',
    body       TEXT NOT NULL,
    visible_to_member BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coop_dividend_runs (
    id                     UUID PRIMARY KEY,
    year                   INTEGER NOT NULL,
    status                 VARCHAR(20) NOT NULL DEFAULT 'prepared',
    pool_kobo              BIGINT NOT NULL DEFAULT 0,
    contribution_pool_kobo BIGINT NOT NULL DEFAULT 0,
    guarantee_pool_kobo    BIGINT NOT NULL DEFAULT 0,
    distributable_kobo     BIGINT NOT NULL DEFAULT 0,
    carry_kobo             BIGINT NOT NULL DEFAULT 0,
    payout_mode            VARCHAR(20) NOT NULL DEFAULT 'wallet',
    prepared_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    reconciled_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    reconciled_at          TIMESTAMPTZ,
    request_id             UUID REFERENCES coop_requests(id),
    approved_at            TIMESTAMPTZ,
    paid_at                TIMESTAMPTZ,
    report                 JSONB,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coop_dividend_runs_year_uq ON coop_dividend_runs(year) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS coop_dividend_lines (
    id                UUID PRIMARY KEY,
    run_id            UUID NOT NULL REFERENCES coop_dividend_runs(id) ON DELETE CASCADE,
    member_id         UUID NOT NULL REFERENCES coop_members(id),
    contribution_kobo BIGINT NOT NULL DEFAULT 0,
    guarantee_kobo    BIGINT NOT NULL DEFAULT 0,
    total_kobo        BIGINT NOT NULL DEFAULT 0,
    qualified         BOOLEAN NOT NULL DEFAULT FALSE,
    reason            VARCHAR(200),
    paid_at           TIMESTAMPTZ,
    CONSTRAINT coop_dividend_lines_uq UNIQUE (run_id, member_id)
);

CREATE TABLE IF NOT EXISTS coop_dividend_disputes (
    id          UUID PRIMARY KEY,
    run_id      UUID NOT NULL REFERENCES coop_dividend_runs(id) ON DELETE CASCADE,
    member_id   UUID NOT NULL REFERENCES coop_members(id),
    body        TEXT NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'open',
    resolution  TEXT,
    adjust_kobo BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS coop_expenses (
    id          UUID PRIMARY KEY,
    category    VARCHAR(40) NOT NULL,
    amount_kobo BIGINT NOT NULL,
    description VARCHAR(300) NOT NULL,
    spent_on    DATE NOT NULL,
    evidence    TEXT,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    request_id  UUID REFERENCES coop_requests(id),
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coop_idempotency (
    key        VARCHAR(120) NOT NULL,
    user_id    UUID NOT NULL,
    endpoint   VARCHAR(120) NOT NULL,
    response   JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (key, user_id)
);

CREATE TABLE IF NOT EXISTS coop_job_runs (
    name        VARCHAR(60) PRIMARY KEY,
    last_run_at TIMESTAMPTZ NOT NULL,
    last_result JSONB
);

CREATE TABLE IF NOT EXISTS coop_sent (
    key        VARCHAR(160) PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coop_reconciliations (
    id       BIGSERIAL PRIMARY KEY,
    run_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ok       BOOLEAN NOT NULL,
    checks   JSONB NOT NULL,
    position JSONB
);

CREATE TABLE IF NOT EXISTS coop_sweeps (
    id           UUID PRIMARY KEY,
    direction    VARCHAR(20) NOT NULL,
    amount_kobo  BIGINT NOT NULL,
    reference    VARCHAR(120),
    note         VARCHAR(300),
    request_id   UUID REFERENCES coop_requests(id),
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
