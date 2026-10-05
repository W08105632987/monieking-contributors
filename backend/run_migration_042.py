"""
Migration 042: Food Collection Ledger — package items & year-end archive

Creates:
  1. food_package_items
  2. food_collection_year_archives
  3. food_collection_year_archive_costs
Plus indexes and service-role-bypass RLS policies, matching the pattern
used in migrations 037/040/041.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from sqlalchemy import text
from app.core.database import engine

STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS food_package_items (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name           VARCHAR(120) NOT NULL,
        description    TEXT,
        icon           VARCHAR(20),
        display_order  INTEGER NOT NULL DEFAULT 0,
        is_active      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_food_package_items_active_order
        ON food_package_items (is_active, display_order);
    """,
    """
    CREATE TABLE IF NOT EXISTS food_collection_year_archives (
        id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        year_label                          VARCHAR(10) NOT NULL UNIQUE,
        closed_at                           TIMESTAMPTZ NOT NULL DEFAULT now(),
        closed_by                           UUID NOT NULL REFERENCES users(id),
        total_qualified                     INTEGER NOT NULL DEFAULT 0,
        total_collected                     INTEGER NOT NULL DEFAULT 0,
        total_not_collected                 INTEGER NOT NULL DEFAULT 0,
        total_customer_contributions_kobo   BIGINT NOT NULL DEFAULT 0,
        adjustment_kobo                     BIGINT NOT NULL DEFAULT 0,
        adjustment_note                     TEXT,
        total_cost_kobo                     BIGINT NOT NULL DEFAULT 0,
        net_result_kobo                     BIGINT NOT NULL DEFAULT 0,
        created_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS food_collection_year_archive_costs (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        archive_id          UUID NOT NULL REFERENCES food_collection_year_archives(id) ON DELETE CASCADE,
        item_id             UUID REFERENCES food_package_items(id) ON DELETE SET NULL,
        item_name_snapshot  VARCHAR(120) NOT NULL,
        unit_cost_kobo      BIGINT NOT NULL DEFAULT 0,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_food_archive_costs_archive
        ON food_collection_year_archive_costs (archive_id);
    """,
    """
    ALTER TABLE food_entitlements
        ADD COLUMN IF NOT EXISTS archived_in_year_id UUID
            REFERENCES food_collection_year_archives(id) ON DELETE SET NULL;
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_food_entitlements_archived_year
        ON food_entitlements (archived_in_year_id);
    """,
    "ALTER TABLE food_package_items ENABLE ROW LEVEL SECURITY;",
    "ALTER TABLE food_collection_year_archives ENABLE ROW LEVEL SECURITY;",
    "ALTER TABLE food_collection_year_archive_costs ENABLE ROW LEVEL SECURITY;",
    'DROP POLICY IF EXISTS "service_role_bypass_food_package_items" ON food_package_items;',
    'CREATE POLICY "service_role_bypass_food_package_items" ON food_package_items FOR ALL TO service_role USING (TRUE);',
    'DROP POLICY IF EXISTS "service_role_bypass_food_year_archives" ON food_collection_year_archives;',
    'CREATE POLICY "service_role_bypass_food_year_archives" ON food_collection_year_archives FOR ALL TO service_role USING (TRUE);',
    'DROP POLICY IF EXISTS "service_role_bypass_food_year_archive_costs" ON food_collection_year_archive_costs;',
    'CREATE POLICY "service_role_bypass_food_year_archive_costs" ON food_collection_year_archive_costs FOR ALL TO service_role USING (TRUE);',
]


async def run():
    async with engine.begin() as conn:
        for i, stmt in enumerate(STATEMENTS, 1):
            print(f"[migration 042] running statement {i}/{len(STATEMENTS)}...")
            await conn.execute(text(stmt))
    print("[migration 042] done.")


if __name__ == "__main__":
    asyncio.run(run())
