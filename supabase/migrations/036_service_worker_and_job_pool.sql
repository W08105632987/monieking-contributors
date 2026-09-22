-- =============================================================================
-- 036 · Service Worker Role, Manual Service Job Pool, Dispute Enhancements
-- =============================================================================

-- ─── 1. Extend user_role enum ─────────────────────────────────────────────────
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'service_worker';

-- ─── 2. Add Service Worker profile columns to users ───────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS state_of_residence         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS referral_code              VARCHAR(20) UNIQUE,
  ADD COLUMN IF NOT EXISTS commission_balance_kobo    BIGINT      NOT NULL DEFAULT 0;

-- ─── 3. Manual service request status enum ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'manual_service_status') THEN
    CREATE TYPE manual_service_status AS ENUM (
      'pending',
      'processing',
      'successful',
      'failed'
    );
  END IF;
END$$;

-- ─── 4. Manual service requests table (the Job Pool) ─────────────────────────
CREATE TABLE IF NOT EXISTS manual_service_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Service classification
  service_category        VARCHAR(100) NOT NULL,
  service_type            VARCHAR(100) NOT NULL,

  -- Submitted data (all form fields)
  form_data               JSONB NOT NULL DEFAULT '{}',

  -- Customer-uploaded files (passport, proof of address, etc.)
  uploaded_files          JSONB NOT NULL DEFAULT '[]',

  -- Pricing & consent
  price_kobo              BIGINT NOT NULL DEFAULT 0,
  consent_given           BOOLEAN NOT NULL DEFAULT FALSE,

  -- Optional referral to a specific worker
  referred_worker_id      UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Job lifecycle
  status                  manual_service_status NOT NULL DEFAULT 'pending',
  claimed_by_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_at              TIMESTAMPTZ,
  expires_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,

  -- Worker resolution
  worker_status           VARCHAR(50),        -- 'successful' | 'failed'
  worker_response         TEXT,
  worker_remarks          TEXT,
  worker_additional_info  TEXT,
  worker_result_file_url  TEXT,

  -- Commission
  worker_commission_kobo  BIGINT NOT NULL DEFAULT 0,

  -- Linked dispute (if any)
  dispute_id              UUID,               -- FK added after disputes table update below

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 5. Extend disputes table for worker routing & escalation ─────────────────
ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS service_request_id   UUID REFERENCES manual_service_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_worker_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_escalated         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS escalated_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_reason    TEXT;

-- ─── 6. Extend dispute_messages for file attachments ─────────────────────────
ALTER TABLE dispute_messages
  ADD COLUMN IF NOT EXISTS attachment_url   TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS attachment_size  INTEGER;

-- ─── 7. Service worker withdrawal requests ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sw_withdrawal_status') THEN
    CREATE TYPE sw_withdrawal_status AS ENUM (
      'pending',
      'processing',
      'paid',
      'rejected'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS service_worker_withdrawals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_kobo     BIGINT NOT NULL,
  account_number  VARCHAR(20) NOT NULL,
  account_name    VARCHAR(200) NOT NULL,
  bank_name       VARCHAR(100) NOT NULL,
  status          sw_withdrawal_status NOT NULL DEFAULT 'pending',
  reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ
);

-- ─── 8. System config defaults for service worker settings ────────────────────
INSERT INTO system_config (key, value, description)
VALUES
  ('service_worker_job_timeout_minutes',        '30',  'Minutes before an uncompleted claimed job is returned to the pool'),
  ('service_worker_default_commission_percent', '10',  'Default commission percentage awarded to service workers on job completion')
ON CONFLICT (key) DO NOTHING;

-- ─── 9. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_manual_service_requests_user_id      ON manual_service_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_manual_service_requests_status        ON manual_service_requests (status);
CREATE INDEX IF NOT EXISTS idx_manual_service_requests_claimed_by_id ON manual_service_requests (claimed_by_id);
CREATE INDEX IF NOT EXISTS idx_manual_service_requests_created_at    ON manual_service_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_service_requests_expires_at    ON manual_service_requests (expires_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_sw_withdrawals_worker_id              ON service_worker_withdrawals (worker_id);
CREATE INDEX IF NOT EXISTS idx_sw_withdrawals_status                 ON service_worker_withdrawals (status);
CREATE INDEX IF NOT EXISTS idx_disputes_service_request_id           ON disputes (service_request_id);
CREATE INDEX IF NOT EXISTS idx_disputes_assigned_worker_id           ON disputes (assigned_worker_id);

-- ─── 10. Now add the back-reference FK from manual_service_requests to disputes ──
ALTER TABLE manual_service_requests
  ADD CONSTRAINT fk_manual_service_requests_dispute
  FOREIGN KEY (dispute_id) REFERENCES disputes(id) ON DELETE SET NULL;

-- ─── 11. Row-Level Security ───────────────────────────────────────────────────
ALTER TABLE manual_service_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_worker_withdrawals ENABLE ROW LEVEL SECURITY;

-- manual_service_requests: service_role bypass
CREATE POLICY "service_role_bypass_manual_service_requests"
  ON manual_service_requests FOR ALL TO service_role USING (TRUE);

-- manual_service_requests: authenticated read own requests
CREATE POLICY "customer_read_own_manual_service_requests"
  ON manual_service_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- service_worker_withdrawals: service_role bypass
CREATE POLICY "service_role_bypass_sw_withdrawals"
  ON service_worker_withdrawals FOR ALL TO service_role USING (TRUE);

-- service_worker_withdrawals: worker reads own
CREATE POLICY "worker_read_own_sw_withdrawals"
  ON service_worker_withdrawals FOR SELECT TO authenticated
  USING (worker_id = auth.uid());

-- ─── 12. updated_at trigger for manual_service_requests ──────────────────────
CREATE OR REPLACE FUNCTION set_manual_service_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_manual_service_requests_updated_at
  BEFORE UPDATE ON manual_service_requests
  FOR EACH ROW EXECUTE FUNCTION set_manual_service_updated_at();
