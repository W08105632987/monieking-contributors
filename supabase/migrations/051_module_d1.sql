-- 051: Module D1 — test-account marking, offline customer import, director PIN. Additive, idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS offline_import_batches (
  id UUID PRIMARY KEY,
  created_by UUID NOT NULL REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'excel',
  filename TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  undone_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_offline_customers (
  id UUID PRIMARY KEY,
  batch_id UUID REFERENCES offline_import_batches(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  zone_id UUID NOT NULL REFERENCES zones(id),
  card_type VARCHAR(20) NOT NULL DEFAULT 'regular',
  rate_kobo BIGINT NOT NULL,
  days_contributed INTEGER NOT NULL DEFAULT 0,
  days_withdrawn INTEGER NOT NULL DEFAULT 0,
  withdrawn_kobo BIGINT NOT NULL DEFAULT 0,
  start_date DATE,
  handled_by VARCHAR(20) NOT NULL DEFAULT 'self',
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  claimed_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_offline_phone_card
  ON pending_offline_customers (phone_number, card_type) WHERE claimed_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pending_offline_phone ON pending_offline_customers (phone_number);

-- Payment PIN: one 4-digit PIN for every authorisation (airtime, bills, identity services, bank details, director actions).
-- The withdrawal password stays, and is used only to withdraw from a card or the cooperative.
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;
