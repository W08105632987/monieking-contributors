"""
Migration 070: kyc_lookups, one row per Techhub NIN lookup made to verify a customer (KYC).
Holds no NIN and no name. It exists so the accounting center can show what Techhub charges us for onboarding.
Additive and idempotent (safe to run more than once).
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from sqlalchemy import text
from app.core.database import engine

STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS kyc_lookups (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
        kind        VARCHAR(8)  NOT NULL DEFAULT 'nin',
        tier        VARCHAR(12) NOT NULL DEFAULT 'regular',
        outcome     VARCHAR(12) NOT NULL,
        source      VARCHAR(10) NOT NULL DEFAULT 'customer',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_kyc_lookups_created ON kyc_lookups (created_at);",
    "ALTER TABLE kyc_lookups ENABLE ROW LEVEL SECURITY;",
    'DROP POLICY IF EXISTS "service_role_bypass_kyc_lookups" ON kyc_lookups;',
    """
    CREATE POLICY "service_role_bypass_kyc_lookups"
        ON kyc_lookups FOR ALL TO service_role USING (TRUE);
    """,
]


async def run():
    async with engine.begin() as conn:
        for i, stmt in enumerate(STATEMENTS, 1):
            print(f"[migration 070] running statement {i}/{len(STATEMENTS)}...")
            await conn.execute(text(stmt))
    print("[migration 070] done.")


if __name__ == "__main__":
    asyncio.run(run())
