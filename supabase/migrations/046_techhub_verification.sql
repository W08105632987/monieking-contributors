-- Migration 046: Techhub NIN / BVN verification
-- Additive and idempotent. Creates only verification_* tables; touches no
-- existing table. The feature ships OFF (system_config verification.techhub_enabled
-- is not set) so running this migration changes nothing customers can see.

CREATE TABLE IF NOT EXISTS verification_lookups (
    id                 UUID PRIMARY KEY,
    kind               VARCHAR(8)  NOT NULL,                 -- nin | bvn
    method             VARCHAR(16) NOT NULL,                 -- nin | phone | demographic | bvn
    customer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    initiated_by_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    officer_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    client_request_id  VARCHAR(64) NOT NULL,
    status             VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | found | not_found | failed
    failure_reason     VARCHAR(200),
    tier_used          VARCHAR(12),
    fee_kobo           BIGINT NOT NULL DEFAULT 0,
    fee_reference      VARCHAR(100),
    consent_at         TIMESTAMPTZ NOT NULL,
    summary            JSONB,                                  -- masked, kept after retention
    result_enc         BYTEA,                                  -- encrypted person data (JSON)
    pdf_enc            BYTEA,                                  -- encrypted Techhub PDF of tier_used
    photo_enc          BYTEA,                                  -- encrypted portrait JPEG
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at       TIMESTAMPTZ,
    expires_at         TIMESTAMPTZ,
    purged_at          TIMESTAMPTZ,
    CONSTRAINT verification_lookups_req_uq UNIQUE (initiated_by_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS verification_lookups_customer_idx ON verification_lookups(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS verification_lookups_expiry_idx ON verification_lookups(expires_at) WHERE purged_at IS NULL;

CREATE TABLE IF NOT EXISTS verification_slips (
    id            UUID PRIMARY KEY,
    lookup_id     UUID NOT NULL REFERENCES verification_lookups(id) ON DELETE CASCADE,
    tier          VARCHAR(12) NOT NULL,
    price_kobo    BIGINT NOT NULL,
    reference     VARCHAR(100) NOT NULL,
    pdf_enc       BYTEA,                                       -- NULL when served from the lookup's own PDF
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    purged_at     TIMESTAMPTZ,
    CONSTRAINT verification_slips_once_uq UNIQUE (lookup_id, tier)
);

CREATE TABLE IF NOT EXISTS verification_service_state (
    service           VARCHAR(8) PRIMARY KEY,                  -- nin | bvn
    failures          INTEGER NOT NULL DEFAULT 0,
    opened_at         TIMESTAMPTZ,
    last_reason       VARCHAR(40),
    alerted           BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO verification_service_state (service) VALUES ('nin'), ('bvn') ON CONFLICT (service) DO NOTHING;
