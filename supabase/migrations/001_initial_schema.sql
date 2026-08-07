-- ================================================================
-- MonieKing Contributors — Initial Database Schema
-- Migration: 001_initial_schema.sql
-- All monetary values stored as BIGINT in kobo (1 NGN = 100 kobo)
-- ================================================================

-- ── Extensions ───────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('customer', 'officer', 'admin', 'director');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'pending_verification');
CREATE TYPE card_type AS ENUM ('regular', 'food');
CREATE TYPE card_status AS ENUM ('active', 'completed', 'converted', 'archived');
CREATE TYPE card_completion_status AS ENUM ('paid', 'unpaid', 'withdrawal_pending');
CREATE TYPE contribution_method AS ENUM ('digital', 'cash_via_officer');
CREATE TYPE withdrawal_status AS ENUM ('pending', 'claimed', 'paid', 'rejected');
CREATE TYPE tx_type AS ENUM ('credit', 'debit');
CREATE TYPE tx_category AS ENUM (
  'wallet_funding', 'contribution', 'withdrawal',
  'charge', 'officer_contribution', 'reversal'
);
CREATE TYPE notification_type AS ENUM ('info', 'success', 'warning', 'error', 'broadcast');

-- ── zones ────────────────────────────────────────────────────────
CREATE TABLE zones (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── users ────────────────────────────────────────────────────────
CREATE TABLE users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        user_role   NOT NULL,
  full_name   TEXT        NOT NULL,
  phone_number TEXT       NOT NULL UNIQUE,

  bank_name       TEXT,
  account_number  TEXT,
  account_name    TEXT,
  face_image_url  TEXT,

  next_of_kin_name  TEXT,
  next_of_kin_phone TEXT,

  zone_id    UUID REFERENCES zones(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  is_manual_customer   BOOLEAN NOT NULL DEFAULT FALSE,
  managing_officer_id  UUID    REFERENCES users(id) ON DELETE SET NULL,

  login_password_hash       TEXT,
  withdrawal_password_hash  TEXT,

  status      user_status NOT NULL DEFAULT 'pending_verification',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_role        ON users(role);
CREATE INDEX idx_users_zone_id     ON users(zone_id);
CREATE INDEX idx_users_status      ON users(status);
CREATE INDEX idx_users_phone       ON users(phone_number);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── wallets ───────────────────────────────────────────────────────
CREATE TABLE wallets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_kobo BIGINT NOT NULL DEFAULT 0 CHECK (balance_kobo >= 0),
  virtual_account_number TEXT UNIQUE,
  virtual_account_bank   TEXT,
  virtual_account_ref    TEXT UNIQUE,
  is_frozen   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallets_owner_id       ON wallets(owner_id);
CREATE INDEX idx_wallets_account_number ON wallets(virtual_account_number);

-- ── contribution_cards ────────────────────────────────────────────
CREATE TABLE contribution_cards (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_type   card_type   NOT NULL,
  rate_kobo   BIGINT      NOT NULL CHECK (rate_kobo > 0),

  total_days_contributed INTEGER NOT NULL DEFAULT 0 CHECK (total_days_contributed >= 0),
  total_contributed_kobo BIGINT  NOT NULL DEFAULT 0 CHECK (total_contributed_kobo >= 0),

  status             card_status            NOT NULL DEFAULT 'active',
  completion_status  card_completion_status,
  food_eligibility_lost_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT max_days CHECK (total_days_contributed <= 372)
);

CREATE INDEX idx_cards_owner_id  ON contribution_cards(owner_id);
CREATE INDEX idx_cards_status    ON contribution_cards(status);
CREATE INDEX idx_cards_card_type ON contribution_cards(card_type);

-- ── contribution_records ──────────────────────────────────────────
CREATE TABLE contribution_records (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id       UUID    NOT NULL REFERENCES contribution_cards(id) ON DELETE CASCADE,
  logical_month SMALLINT NOT NULL CHECK (logical_month BETWEEN 1 AND 12),
  logical_day   SMALLINT NOT NULL CHECK (logical_day   BETWEEN 1 AND 31),
  amount_kobo   BIGINT  NOT NULL CHECK (amount_kobo > 0),
  contributed_by UUID   NOT NULL REFERENCES users(id),
  method        contribution_method NOT NULL,
  reference     TEXT    NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (card_id, logical_month, logical_day)
);

CREATE INDEX idx_contrib_records_card_id ON contribution_records(card_id);
CREATE INDEX idx_contrib_records_month_day ON contribution_records(card_id, logical_month, logical_day);

-- ── wallet_transactions ───────────────────────────────────────────
CREATE TABLE wallet_transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id           UUID        NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type                tx_type     NOT NULL,
  category            tx_category NOT NULL,
  amount_kobo         BIGINT      NOT NULL CHECK (amount_kobo > 0),
  balance_after_kobo  BIGINT      NOT NULL,
  reference           TEXT        NOT NULL UNIQUE,
  description         TEXT,
  related_card_id         UUID REFERENCES contribution_cards(id) ON DELETE SET NULL,
  related_withdrawal_id   UUID,   -- FK added after withdrawals table
  initiated_by        UUID        NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_tx_wallet_id  ON wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_tx_category   ON wallet_transactions(category);
CREATE INDEX idx_wallet_tx_created_at ON wallet_transactions(created_at DESC);

-- ── withdrawals ───────────────────────────────────────────────────
CREATE TABLE withdrawals (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id           UUID NOT NULL REFERENCES users(id),
  card_id               UUID NOT NULL REFERENCES contribution_cards(id),
  requested_amount_kobo BIGINT NOT NULL CHECK (requested_amount_kobo > 0),
  charge_kobo           BIGINT NOT NULL CHECK (charge_kobo >= 0),
  net_payable_kobo      BIGINT NOT NULL CHECK (net_payable_kobo > 0),
  bank_name             TEXT NOT NULL,
  account_number        TEXT NOT NULL,
  account_name          TEXT NOT NULL,
  status                withdrawal_status NOT NULL DEFAULT 'pending',
  claimed_by_director_id UUID REFERENCES users(id),
  claimed_at            TIMESTAMPTZ,
  processed_at          TIMESTAMPTZ,
  rejection_reason      TEXT,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_withdrawals_customer_id ON withdrawals(customer_id);
CREATE INDEX idx_withdrawals_status      ON withdrawals(status);
CREATE INDEX idx_withdrawals_requested   ON withdrawals(requested_at ASC);
CREATE INDEX idx_withdrawals_director    ON withdrawals(claimed_by_director_id);

-- Add FK from wallet_transactions to withdrawals
ALTER TABLE wallet_transactions
  ADD CONSTRAINT fk_wallet_tx_withdrawal
  FOREIGN KEY (related_withdrawal_id) REFERENCES withdrawals(id) ON DELETE SET NULL;

-- ── notifications ─────────────────────────────────────────────────
CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  type              notification_type NOT NULL DEFAULT 'info',
  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  related_entity_id UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id  ON notifications(user_id);
CREATE INDEX idx_notifications_is_read  ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created  ON notifications(created_at DESC);

-- ── broadcasts ────────────────────────────────────────────────────
CREATE TABLE broadcasts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sent_by        UUID NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  target_roles   TEXT NOT NULL DEFAULT 'all',
  target_zone_id UUID REFERENCES zones(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── audit_logs ────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id    UUID        NOT NULL REFERENCES users(id),
  action      TEXT        NOT NULL,
  entity_type TEXT        NOT NULL,
  entity_id   TEXT        NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log is append-only — revoke UPDATE and DELETE
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;

CREATE INDEX idx_audit_logs_actor_id    ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_entity      ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_action      ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at  ON audit_logs(created_at DESC);

-- ── payment_webhooks ──────────────────────────────────────────────
CREATE TABLE payment_webhooks (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider              TEXT        NOT NULL DEFAULT 'monnify',
  transaction_reference TEXT        NOT NULL UNIQUE,
  amount_kobo           BIGINT,
  account_number        TEXT,
  raw_payload           JSONB       NOT NULL,
  processed             BOOLEAN     NOT NULL DEFAULT FALSE,
  processing_error      TEXT,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at          TIMESTAMPTZ
);

CREATE INDEX idx_webhooks_reference  ON payment_webhooks(transaction_reference);
CREATE INDEX idx_webhooks_processed  ON payment_webhooks(processed);
CREATE INDEX idx_webhooks_account    ON payment_webhooks(account_number);

-- ── webauthn_credentials ──────────────────────────────────────────
CREATE TABLE webauthn_credentials (
  id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id   TEXT    NOT NULL UNIQUE,
  public_key      TEXT    NOT NULL,
  sign_count      BIGINT  NOT NULL DEFAULT 0,
  device_name     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX idx_webauthn_user_id ON webauthn_credentials(user_id);

-- ── officer_credit_lines ──────────────────────────────────────────
CREATE TABLE officer_credit_lines (
  id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  officer_id      UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by      UUID    NOT NULL REFERENCES users(id),
  amount_kobo     BIGINT  NOT NULL CHECK (amount_kobo > 0),
  used_kobo       BIGINT  NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── system_config ─────────────────────────────────────────────────
CREATE TABLE system_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default config values
INSERT INTO system_config (key, value, description) VALUES
  ('max_food_cards_per_customer', '2',  'Maximum Food Cards a single customer can own'),
  ('withdrawal_sla_hours',        '24', 'Director withdrawal processing SLA in hours'),
  ('min_regular_card_rate_kobo',  '50000', 'Minimum Regular Card daily rate (₦500)'),
  ('large_contribution_threshold_kobo', '5000000', 'Threshold requiring dual Officer approval (₦50,000)');

