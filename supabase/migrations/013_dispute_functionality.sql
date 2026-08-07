-- ============================================================
-- Migration: retroactive indexes + disputes feature
-- Run this directly against your Supabase database (SQL editor,
-- or `psql $DATABASE_URL -f this_file.sql`)
-- ============================================================

-- ── Part 1: retroactive indexes on existing high-traffic columns ──
-- Every one of these is filtered on in a query that fires on nearly
-- every page load — none of them had an index before. Safe, zero-risk,
-- purely additive (same query results, just fast once tables grow).

CREATE INDEX IF NOT EXISTS ix_notifications_user_id        ON notifications (user_id);
CREATE INDEX IF NOT EXISTS ix_notifications_user_unread     ON notifications (user_id, is_read);

CREATE INDEX IF NOT EXISTS ix_withdrawals_status            ON withdrawals (status);
CREATE INDEX IF NOT EXISTS ix_withdrawals_card_id           ON withdrawals (card_id);
CREATE INDEX IF NOT EXISTS ix_withdrawals_customer_id       ON withdrawals (customer_id);

CREATE INDEX IF NOT EXISTS ix_contribution_records_card_id  ON contribution_records (card_id);
CREATE INDEX IF NOT EXISTS ix_contribution_cards_owner_id   ON contribution_cards (owner_id);
CREATE INDEX IF NOT EXISTS ix_contribution_cards_status     ON contribution_cards (status);

CREATE INDEX IF NOT EXISTS ix_wallet_transactions_wallet_id ON wallet_transactions (wallet_id);
CREATE INDEX IF NOT EXISTS ix_wallets_owner_id              ON wallets (owner_id);

CREATE INDEX IF NOT EXISTS ix_users_zone_id                 ON users (zone_id);
CREATE INDEX IF NOT EXISTS ix_users_role                    ON users (role);
CREATE INDEX IF NOT EXISTS ix_users_status                  ON users (status);


-- ── Part 2: disputes feature tables ──

CREATE TYPE dispute_entity_type AS ENUM ('wallet_transaction', 'withdrawal');
CREATE TYPE dispute_status      AS ENUM ('open', 'under_review', 'escalated', 'resolved');
CREATE TYPE dispute_reason      AS ENUM (
    'not_mine', 'amount_wrong', 'duplicate',
    'money_not_received', 'rejected_in_error', 'other'
);

CREATE TABLE disputes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raised_by           UUID NOT NULL REFERENCES users(id),
    entity_type         dispute_entity_type NOT NULL,
    entity_id           UUID NOT NULL,          -- points into wallet_transactions.id or withdrawals.id
                                                  -- (not a real FK on purpose — see model docstring)
    reason              dispute_reason NOT NULL,
    status              dispute_status NOT NULL DEFAULT 'open',
    assigned_to         UUID REFERENCES users(id),   -- NULL = open director queue
    zone_id             UUID REFERENCES zones(id) ON DELETE SET NULL,
    resolution_summary  TEXT,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dispute_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id  UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    sender_id   UUID NOT NULL REFERENCES users(id),
    message     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_disputes_raised_by      ON disputes (raised_by);
CREATE INDEX ix_disputes_assigned_to    ON disputes (assigned_to);
CREATE INDEX ix_disputes_status         ON disputes (status);
CREATE INDEX ix_disputes_entity         ON disputes (entity_type, entity_id);
CREATE INDEX ix_dispute_messages_dispute_id ON dispute_messages (dispute_id);