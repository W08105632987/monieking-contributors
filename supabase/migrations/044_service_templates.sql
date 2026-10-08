-- Migration 044: Service templates (Phase 2 of the services rebuild)
--
-- Director-built service templates. Additive and INERT: nothing reads these
-- tables until Phase 3 switches each service over. Safe to run more than once.
--
-- Rollback (only if nothing has been switched over yet):
--   DROP TABLE IF EXISTS service_template_versions; DROP TABLE IF EXISTS service_templates;

CREATE TABLE IF NOT EXISTS service_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_code        VARCHAR(100) NOT NULL UNIQUE,      -- the charged category, e.g. 'nin_modification'
    kind                VARCHAR(20)  NOT NULL DEFAULT 'manual',   -- 'manual' (worker-fulfilled) | 'api' (provider-fulfilled)
    title               VARCHAR(200) NOT NULL,
    description         TEXT,
    is_enabled          BOOLEAN      NOT NULL DEFAULT FALSE,      -- director's on/off switch
    current_version_id  UUID,                                    -- the published version customers see
    archived_at         TIMESTAMPTZ,                             -- archive instead of delete
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT service_templates_kind_check CHECK (kind IN ('manual', 'api'))
);

CREATE TABLE IF NOT EXISTS service_template_versions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id   UUID    NOT NULL REFERENCES service_templates(id) ON DELETE CASCADE,
    version       INTEGER NOT NULL,
    schema        JSONB   NOT NULL,        -- selectors + fields (immutable once published)
    price_rules   JSONB   NOT NULL,        -- ordered rules, first match wins, last is the default
    note          TEXT,                    -- e.g. 'Initial version seeded from live prices'
    created_by    UUID,                    -- no FK on purpose: the immutability trigger would block 'ON DELETE SET NULL'
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (template_id, version)
);

CREATE INDEX IF NOT EXISTS idx_service_template_versions_template
    ON service_template_versions (template_id, version DESC);

-- current_version_id points at a version of THIS template (added after both tables exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_templates_current_version_fk') THEN
        ALTER TABLE service_templates
            ADD CONSTRAINT service_templates_current_version_fk
            FOREIGN KEY (current_version_id) REFERENCES service_template_versions(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Published versions are immutable: block UPDATE and DELETE on the version rows.
CREATE OR REPLACE FUNCTION service_template_versions_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'service_template_versions rows are immutable; publish a new version instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_service_template_versions_immutable ON service_template_versions;
CREATE TRIGGER trg_service_template_versions_immutable
    BEFORE UPDATE ON service_template_versions
    FOR EACH ROW EXECUTE FUNCTION service_template_versions_immutable();
-- (DELETE is allowed only through the template's ON DELETE CASCADE; nothing in the app deletes templates.)

-- Every request will record which version it was submitted under (used from Phase 3).
ALTER TABLE manual_service_requests
    ADD COLUMN IF NOT EXISTS template_version_id UUID REFERENCES service_template_versions(id) ON DELETE SET NULL;

ALTER TABLE service_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_template_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_bypass_service_templates" ON service_templates;
CREATE POLICY "service_role_bypass_service_templates"
    ON service_templates FOR ALL TO service_role USING (TRUE);
DROP POLICY IF EXISTS "service_role_bypass_service_template_versions" ON service_template_versions;
CREATE POLICY "service_role_bypass_service_template_versions"
    ON service_template_versions FOR ALL TO service_role USING (TRUE);
