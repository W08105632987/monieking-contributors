-- Migration 045: MonieKing Cooperative (preview foundation)
-- Additive and idempotent. Creates only coop_* tables. Touches no existing table.
-- All money in this module is TEST money recorded in coop_journal; no wallet is used.

CREATE SEQUENCE IF NOT EXISTS coop_card_seq START 1;
CREATE SEQUENCE IF NOT EXISTS coop_loan_seq START 1;

CREATE TABLE IF NOT EXISTS coop_settings (
    key         VARCHAR(80) PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS coop_setting_changes (
    id            UUID PRIMARY KEY,
    key           VARCHAR(80) NOT NULL,
    old_value     TEXT,
    new_value     TEXT NOT NULL,
    effect        VARCHAR(20) NOT NULL,
    effective_on  DATE,
    reason        TEXT,
    status        VARCHAR(20) NOT NULL DEFAULT 'pending',
    proposed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS coop_setting_changes_status_idx ON coop_setting_changes(status);

CREATE TABLE IF NOT EXISTS coop_setting_change_approvals (
    id           UUID PRIMARY KEY,
    change_id    UUID NOT NULL REFERENCES coop_setting_changes(id) ON DELETE CASCADE,
    director_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision     VARCHAR(10) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT coop_setting_change_approvals_uq UNIQUE (change_id, director_id)
);

CREATE TABLE IF NOT EXISTS coop_pilot_members (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    added_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coop_members (
    id                   UUID PRIMARY KEY,
    user_id              UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    card_no              VARCHAR(20) NOT NULL UNIQUE,
    status               VARCHAR(20) NOT NULL DEFAULT 'active',
    registered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    nin_bypassed         BOOLEAN NOT NULL DEFAULT FALSE,
    disqualified_year    INTEGER,
    pool_listed          BOOLEAN NOT NULL DEFAULT FALSE,
    pool_offer_kobo      BIGINT NOT NULL DEFAULT 0,
    pool_whatsapp_ok     BOOLEAN NOT NULL DEFAULT FALSE,
    pool_note            VARCHAR(300),
    closed_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS coop_loans (
    id                  UUID PRIMARY KEY,
    loan_no             VARCHAR(20) NOT NULL UNIQUE,
    member_id           UUID NOT NULL REFERENCES coop_members(id),
    purpose             VARCHAR(200),
    principal_kobo      BIGINT NOT NULL CHECK (principal_kobo > 0),
    term_months         INTEGER NOT NULL CHECK (term_months > 0),
    rate_bps            INTEGER NOT NULL,
    interest_kobo       BIGINT NOT NULL,
    total_kobo          BIGINT NOT NULL,
    overdue_daily_bps   INTEGER NOT NULL,
    overdue_cap_pct     INTEGER NOT NULL DEFAULT 0,
    overdue_grace_days  INTEGER NOT NULL DEFAULT 0,
    cover_pct           INTEGER NOT NULL,
    approvals_required  INTEGER NOT NULL,
    schedule            JSONB NOT NULL DEFAULT '[]'::jsonb,
    flags               JSONB NOT NULL DEFAULT '[]'::jsonb,
    status              VARCHAR(30) NOT NULL DEFAULT 'seeking_guarantors',
    expires_at          TIMESTAMPTZ,
    approved_at         TIMESTAMPTZ,
    start_date          DATE,
    due_date            DATE,
    principal_paid_kobo BIGINT NOT NULL DEFAULT 0,
    interest_paid_kobo  BIGINT NOT NULL DEFAULT 0,
    charges_paid_kobo   BIGINT NOT NULL DEFAULT 0,
    closed_at           TIMESTAMPTZ,
    decision_note       VARCHAR(300),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coop_loans_member_idx ON coop_loans(member_id);
CREATE INDEX IF NOT EXISTS coop_loans_status_idx ON coop_loans(status);

CREATE TABLE IF NOT EXISTS coop_loan_approvals (
    id           UUID PRIMARY KEY,
    loan_id      UUID NOT NULL REFERENCES coop_loans(id) ON DELETE CASCADE,
    director_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision     VARCHAR(10) NOT NULL,
    note         VARCHAR(300),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT coop_loan_approvals_uq UNIQUE (loan_id, director_id)
);

CREATE TABLE IF NOT EXISTS coop_contract_versions (
    id          UUID PRIMARY KEY,
    version     VARCHAR(30) NOT NULL UNIQUE,
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coop_guarantees (
    id                   UUID PRIMARY KEY,
    loan_id              UUID NOT NULL REFERENCES coop_loans(id) ON DELETE CASCADE,
    guarantor_id         UUID NOT NULL REFERENCES coop_members(id),
    amount_kobo          BIGINT NOT NULL CHECK (amount_kobo > 0),
    status               VARCHAR(20) NOT NULL DEFAULT 'invited',
    invited_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at           TIMESTAMPTZ NOT NULL,
    viewed_at            TIMESTAMPTZ,
    signed_at            TIMESTAMPTZ,
    released_at          TIMESTAMPTZ,
    contract_version     VARCHAR(30),
    contract_text        TEXT,
    contract_hash        VARCHAR(64),
    ticks                JSONB,
    sign_ip              VARCHAR(64),
    sign_agent           VARCHAR(300),
    CONSTRAINT coop_guarantees_loan_guarantor_uq UNIQUE (loan_id, guarantor_id)
);
CREATE INDEX IF NOT EXISTS coop_guarantees_guarantor_idx ON coop_guarantees(guarantor_id);

-- Append-only money book. Corrections are made with reversing entries.
CREATE TABLE IF NOT EXISTS coop_journal (
    id              BIGSERIAL PRIMARY KEY,
    member_id       UUID REFERENCES coop_members(id),
    ledger          VARCHAR(30) NOT NULL,
    entry_type      VARCHAR(40) NOT NULL,
    delta_kobo      BIGINT NOT NULL CHECK (delta_kobo <> 0),
    balance_after   BIGINT NOT NULL DEFAULT 0,
    loan_id         UUID REFERENCES coop_loans(id),
    guarantee_id    UUID REFERENCES coop_guarantees(id),
    reference       VARCHAR(120) NOT NULL UNIQUE,
    accounting_year INTEGER NOT NULL,
    effective_at    TIMESTAMPTZ NOT NULL,
    actor_id        UUID,
    reverses_id     BIGINT REFERENCES coop_journal(id),
    note            VARCHAR(300),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coop_journal_member_ledger_idx ON coop_journal(member_id, ledger);
CREATE INDEX IF NOT EXISTS coop_journal_effective_idx ON coop_journal(effective_at);

-- Audit trail of decisions and events.
CREATE TABLE IF NOT EXISTS coop_events (
    id          BIGSERIAL PRIMARY KEY,
    entity      VARCHAR(30) NOT NULL,
    entity_id   VARCHAR(60),
    action      VARCHAR(60) NOT NULL,
    actor_id    UUID,
    data        JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coop_events_entity_idx ON coop_events(entity, entity_id);

-- Immutability: journal, events and contract versions can never be edited or deleted.
CREATE OR REPLACE FUNCTION coop_block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS coop_journal_immutable ON coop_journal;
CREATE TRIGGER coop_journal_immutable BEFORE UPDATE OR DELETE ON coop_journal
    FOR EACH ROW EXECUTE FUNCTION coop_block_mutation();

DROP TRIGGER IF EXISTS coop_events_immutable ON coop_events;
CREATE TRIGGER coop_events_immutable BEFORE UPDATE OR DELETE ON coop_events
    FOR EACH ROW EXECUTE FUNCTION coop_block_mutation();

DROP TRIGGER IF EXISTS coop_contract_versions_immutable ON coop_contract_versions;
CREATE TRIGGER coop_contract_versions_immutable BEFORE UPDATE OR DELETE ON coop_contract_versions
    FOR EACH ROW EXECUTE FUNCTION coop_block_mutation();
