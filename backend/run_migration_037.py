import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from sqlalchemy import text
from app.core.database import engine

STATEMENTS = [
    # 1. System config for referral hold window
    """
    INSERT INTO system_config (key, value, description)
    VALUES
      ('service_worker_referral_hold_minutes', '30', 'Minutes a referred manual service request is exclusively held for the referred worker before entering the general pool')
    ON CONFLICT (key) DO NOTHING;
    """,

    # 2. Job pool events table
    """
    CREATE TABLE IF NOT EXISTS job_pool_events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id      UUID NOT NULL REFERENCES manual_service_requests(id) ON DELETE CASCADE,
      event_type  VARCHAR(50) NOT NULL,
      actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
      details     JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,

    # 3. Indexes
    """
    CREATE INDEX IF NOT EXISTS idx_job_pool_events_job_id
      ON job_pool_events (job_id);
    """,

    """
    CREATE INDEX IF NOT EXISTS idx_job_pool_events_event_type_created_at
      ON job_pool_events (event_type, created_at);
    """,

    # 4. Row Level Security
    """
    ALTER TABLE job_pool_events ENABLE ROW LEVEL SECURITY;
    """,

    """
    DROP POLICY IF EXISTS "service_role_bypass_job_pool_events" ON job_pool_events;
    """,

    """
    CREATE POLICY "service_role_bypass_job_pool_events"
      ON job_pool_events FOR ALL TO service_role USING (TRUE);
    """
]

async def main():
    print("Applying migration 037 statements to database...", flush=True)
    async with engine.connect() as conn:
        for i, stmt in enumerate(STATEMENTS, 1):
            stmt_clean = stmt.strip()
            if not stmt_clean:
                continue
            print(f"Executing statement {i}/{len(STATEMENTS)}...", flush=True)
            await conn.execute(text(stmt_clean))
        await conn.commit()
    print("SUCCESS: Migration 037 successfully applied to database!", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
