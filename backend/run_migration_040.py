"""
Migration 040: Promo Banner Events Table (Hot-Row Contention Fix)

Changes:
  1. Create promo_banner_events table
  2. Create indexes for fast lookup and user auditing
  3. Enable RLS and setup policies
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from sqlalchemy import text
from app.core.database import engine

STATEMENTS = [
    # ── 1. Create table promo_banner_events ────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS promo_banner_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        banner_id UUID NOT NULL REFERENCES promo_banners(id) ON DELETE CASCADE,
        event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('impression', 'click')),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,

    # ── 2. Compound index for fast aggregation ─────────────────────────────
    """
    CREATE INDEX IF NOT EXISTS idx_promo_banner_events_lookup 
        ON promo_banner_events(banner_id, event_type, created_at);
    """,

    # ── 3. Index for user_id ───────────────────────────────────────────────
    """
    CREATE INDEX IF NOT EXISTS idx_promo_banner_events_user 
        ON promo_banner_events(user_id);
    """,

    # ── 4. Enable RLS ──────────────────────────────────────────────────────
    """
    ALTER TABLE promo_banner_events ENABLE ROW LEVEL SECURITY;
    """,

    # ── 5. RLS Policies ────────────────────────────────────────────────────
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE tablename = 'promo_banner_events' 
            AND policyname = 'Allow authenticated users to insert promo events'
        ) THEN
            CREATE POLICY "Allow authenticated users to insert promo events"
                ON promo_banner_events
                FOR INSERT
                TO authenticated
                WITH CHECK (true);
        END IF;
    END $$;
    """,
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE tablename = 'promo_banner_events' 
            AND policyname = 'Allow directors and admins to read promo events'
        ) THEN
            CREATE POLICY "Allow directors and admins to read promo events"
                ON promo_banner_events
                FOR SELECT
                TO authenticated
                USING (
                    EXISTS (
                        SELECT 1 FROM users 
                        WHERE users.id = auth.uid() 
                        AND users.role IN ('director', 'admin')
                    )
                );
        END IF;
    END $$;
    """,
]


async def run_migration():
    print("Connecting to database...")
    async with engine.begin() as conn:
        for i, stmt in enumerate(STATEMENTS, 1):
            stmt_clean = stmt.strip()
            first_line = stmt_clean.split("\n")[0]
            print(f"[{i}/{len(STATEMENTS)}] Executing: {first_line[:60]}...")
            await conn.execute(text(stmt_clean))
        print("All statements executed successfully!")


if __name__ == "__main__":
    asyncio.run(run_migration())
