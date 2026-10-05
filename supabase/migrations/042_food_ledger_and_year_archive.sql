-- Migration 042: Food Collection Ledger — package items & year-end archive
--
-- Builds the missing reporting/reconciliation layer on top of the already
-- well-designed food_entitlements/food_collection_audits data (nothing in
-- those tables changes here). Three additions:
--   1. food_package_items     — admin/director-editable list of what's in
--                                 the package (currently hardcoded in the
--                                 frontend rules modal)
--   2. food_collection_year_archives       — one row per closed year, the
--                                 final reconciled numbers
--   3. food_collection_year_archive_costs  — per-item unit cost entered at
--                                 close time, preserved even if the live
--                                 item's price changes later

CREATE TABLE IF NOT EXISTS food_package_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(120) NOT NULL,
    description    TEXT,
    icon           VARCHAR(20),              -- emoji or short icon key, matches customer-facing rendering
    display_order  INTEGER NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_food_package_items_active_order
    ON food_package_items (is_active, display_order);

CREATE TABLE IF NOT EXISTS food_collection_year_archives (
    id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year_label                          VARCHAR(10) NOT NULL UNIQUE,   -- e.g. "2025"
    closed_at                           TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_by                           UUID NOT NULL REFERENCES users(id),

    total_qualified                     INTEGER NOT NULL DEFAULT 0,
    total_collected                     INTEGER NOT NULL DEFAULT 0,
    total_not_collected                 INTEGER NOT NULL DEFAULT 0,

    total_customer_contributions_kobo   BIGINT NOT NULL DEFAULT 0,

    adjustment_kobo                     BIGINT NOT NULL DEFAULT 0,     -- can be positive or negative
    adjustment_note                     TEXT,

    total_cost_kobo                     BIGINT NOT NULL DEFAULT 0,     -- (sum of per-item unit costs x total_collected) + adjustment
    net_result_kobo                     BIGINT NOT NULL DEFAULT 0,     -- total_customer_contributions_kobo - total_cost_kobo

    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS food_collection_year_archive_costs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    archive_id          UUID NOT NULL REFERENCES food_collection_year_archives(id) ON DELETE CASCADE,
    item_id             UUID REFERENCES food_package_items(id) ON DELETE SET NULL,
    item_name_snapshot  VARCHAR(120) NOT NULL,   -- preserved even if the live item is later renamed/removed
    unit_cost_kobo      BIGINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_food_archive_costs_archive
    ON food_collection_year_archive_costs (archive_id);

-- Entitlements are created lazily (only when a customer first opens their
-- food page after qualifying — see get_my_food_entitlement), so there is
-- no "year" field to filter a live/closed split on. Instead: every
-- currently-open-cycle entitlement has archived_in_year_id = NULL; closing
-- a year stamps every entitlement swept into that close with the new
-- archive's id, and the live oversight view simply filters on NULL —
-- a fresh cycle starts implicitly the moment a year is closed.
ALTER TABLE food_entitlements
    ADD COLUMN IF NOT EXISTS archived_in_year_id UUID
        REFERENCES food_collection_year_archives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_food_entitlements_archived_year
    ON food_entitlements (archived_in_year_id);

-- RLS: service-role bypass only, same pattern as every other new table
-- added in this codebase (037, 040, 041) — app-level role checks in
-- FastAPI are the actual authorization boundary, same as everywhere else.
ALTER TABLE food_package_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_collection_year_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_collection_year_archive_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_bypass_food_package_items"
    ON food_package_items FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_bypass_food_year_archives"
    ON food_collection_year_archives FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_bypass_food_year_archive_costs"
    ON food_collection_year_archive_costs FOR ALL TO service_role USING (TRUE);
