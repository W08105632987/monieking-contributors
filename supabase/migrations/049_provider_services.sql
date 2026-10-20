-- Migration 049: Techhub-backed manual services (async: delinking, NIN validation, personalization,
-- BVN retrieval, IPE clearance, BVN CRM). Additive and idempotent.
--
-- 1) a new job state: the job was handed to an outside party and waits for the outcome. It stays
--    under the same service worker and is never returned to the pool by the SLA timer.
-- 2) per-service director settings (refund policy, alert days, field mapping ...)
-- 3) one row per request sent to Techhub (also the guard against sending the same job twice)

ALTER TYPE manual_service_status ADD VALUE IF NOT EXISTS 'awaiting_provider';

CREATE TABLE IF NOT EXISTS provider_service_config (
    service_code       VARCHAR(100) PRIMARY KEY,
    provider           VARCHAR(30)  NOT NULL DEFAULT 'techhub',
    enabled            BOOLEAN      NOT NULL DEFAULT FALSE,   -- show the "Send to Techhub" button
    endpoint           VARCHAR(80)  NOT NULL,                 -- e.g. nin_validation.php
    field_map          JSONB        NOT NULL DEFAULT '{}'::jsonb,   -- {techhub param: form field key}
    value_maps         JSONB        NOT NULL DEFAULT '{}'::jsonb,   -- {param: {"from": key, "map": {ours: theirs}}}
    static_params      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    file_params        JSONB        NOT NULL DEFAULT '{}'::jsonb,   -- {param: form field key holding an uploaded file}
    applies_when       JSONB        NOT NULL DEFAULT '{}'::jsonb,   -- {form key or service_type: [values]}; empty = always
    status_param       VARCHAR(30)  NOT NULL DEFAULT 'ticket_id',
    refund_on_failure  BOOLEAN      NOT NULL DEFAULT TRUE,
    alert_after_days   INTEGER      NOT NULL DEFAULT 5 CHECK (alert_after_days BETWEEN 1 AND 60),
    poll_minutes       INTEGER      NOT NULL DEFAULT 30 CHECK (poll_minutes BETWEEN 5 AND 720),
    updated_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_tickets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id           UUID NOT NULL REFERENCES manual_service_requests(id) ON DELETE CASCADE,
    service_code     VARCHAR(100) NOT NULL,
    seq              INTEGER NOT NULL DEFAULT 1,
    provider         VARCHAR(30) NOT NULL DEFAULT 'techhub',
    ticket_ref       VARCHAR(120),                         -- ticket_id / submission_id from the provider
    -- sending: about to call; pending: waiting; success / failed: final; unknown: we could not tell if it went through
    status           VARCHAR(20) NOT NULL DEFAULT 'sending'
                       CHECK (status IN ('sending', 'pending', 'success', 'failed', 'unknown')),
    cost_raw         INTEGER,                              -- amount_charged as the provider reported it
    provider_note    TEXT,
    result           JSONB,
    submitted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_checked_at  TIMESTAMPTZ,
    alerted_at       TIMESTAMPTZ,
    closed_at        TIMESTAMPTZ,
    UNIQUE (job_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_provider_tickets_open ON provider_tickets (status) WHERE status IN ('pending', 'unknown', 'sending');
