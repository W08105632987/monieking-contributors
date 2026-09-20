-- 019_bill_payments.sql
-- Airtime, Data, Electricity, Cable TV, Education payments via Monnify Bills Payment API.
-- Separate from identity_services: variable amounts + a Discovery/Validation/Vend
-- lifecycle rather than a single fixed-price lookup. See
-- docs/MonieKing-Bills-Payment-Plan.md for the full rationale.

CREATE TYPE biller_category AS ENUM ('airtime', 'data', 'electricity', 'cable_tv', 'education');

CREATE TYPE bill_payment_status AS ENUM (
    'pending_validation',  -- awaiting customer to confirm validated account (electricity/cable only)
    'validated',           -- validation confirmed, ready to pay
    'pending',             -- vend call in flight
    'completed',
    'failed',
    'reversed'
);

-- Cached copy of Monnify's biller/product catalog. Refreshed on a schedule
-- (see bill_payment_service.sync_billers), never called live on every page
-- load — Monnify's discovery endpoints are not built for per-request traffic.
CREATE TABLE billers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monnify_biller_id   TEXT NOT NULL,
    category            biller_category NOT NULL,
    name                TEXT NOT NULL,               -- e.g. "Eko Electricity Distribution Company"
    product_id          TEXT NOT NULL,                -- Monnify product code within the biller
    product_name        TEXT NOT NULL,                -- e.g. "Prepaid", "MTN 1GB - 30 days"
    -- Fixed price for products with a set cost (data plans, education
    -- PINs). NULL for variable-amount billers (airtime, electricity),
    -- where the customer types their own amount. The service layer treats
    -- a non-null price here as authoritative and never trusts a
    -- client-supplied amount for a fixed-price product.
    price_kobo          BIGINT,
    requires_validation BOOLEAN NOT NULL DEFAULT false,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (monnify_biller_id, product_id)
);

CREATE INDEX idx_billers_category ON billers(category) WHERE is_active = true;

CREATE TABLE bill_payment_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id             UUID NOT NULL REFERENCES users(id),
    initiated_by            identity_request_initiated_by NOT NULL,   -- reuses the enum from identity_services
    officer_id              UUID REFERENCES users(id),
    biller_id               UUID NOT NULL REFERENCES billers(id),

    customer_reference      TEXT NOT NULL,   -- phone / meter number / smartcard number, masked before storage
    amount_kobo             BIGINT NOT NULL,

    validation_reference    TEXT,            -- from Monnify's Validation phase, null for airtime/data (no validation step)
    validated_account_name  TEXT,            -- returned by Validation, shown to customer as "Is this you?"

    monnify_transaction_reference TEXT,
    status                  bill_payment_status NOT NULL DEFAULT 'pending',
    failure_reason          TEXT,
    token                   TEXT,            -- electricity purchase token — NOT masked, customer needs to retrieve this in full

    amount_charged_kobo     BIGINT,          -- what the wallet was actually debited (may include service fee later)

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at            TIMESTAMPTZ
);

CREATE INDEX idx_bill_payment_requests_customer ON bill_payment_requests(customer_id, created_at DESC);
CREATE INDEX idx_bill_payment_requests_status   ON bill_payment_requests(status);
