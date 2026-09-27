"""
Migration 038: Dispute system overhaul + commission hold mechanism

Changes:
  1. Add MANUAL_SERVICE_REQUEST to dispute_entity_type enum
  2. Add manual-service-specific reasons to dispute_reason enum
  3. Add is_internal to dispute_messages (internal notes)
  4. Add commission_status to manual_service_requests
  5. Add commission_held_kobo + commission_debt_kobo to users
  6. Add archived_at (soft delete) + impressions + clicks to promo_banners
  7. SystemConfig: dispute_sla_hours + dispute_eligibility_window_hours
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from sqlalchemy import text
from app.core.database import engine

STATEMENTS = [

    # ── 1. Add MANUAL_SERVICE_REQUEST to dispute_entity_type enum ──────────
    """
    DO $$ BEGIN
      ALTER TYPE dispute_entity_type ADD VALUE IF NOT EXISTS 'manual_service_request';
    END $$;
    """,

    # ── 2. Extend dispute_reason enum with manual-service values ───────────
    """
    DO $$ BEGIN
      ALTER TYPE dispute_reason ADD VALUE IF NOT EXISTS 'service_not_completed_correctly';
      ALTER TYPE dispute_reason ADD VALUE IF NOT EXISTS 'customer_info_incorrect';
      ALTER TYPE dispute_reason ADD VALUE IF NOT EXISTS 'portal_unavailable';
      ALTER TYPE dispute_reason ADD VALUE IF NOT EXISTS 'commission_dispute';
      ALTER TYPE dispute_reason ADD VALUE IF NOT EXISTS 'communication_issue';
    END $$;
    """,

    # ── 3. Internal notes flag on dispute messages ─────────────────────────
    """
    ALTER TABLE dispute_messages
      ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;
    """,

    # ── 4. commission_status enum + column on manual_service_requests ──────
    """
    DO $$ BEGIN
      CREATE TYPE commission_status AS ENUM ('cleared', 'held', 'reversed');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
    """,

    """
    ALTER TABLE manual_service_requests
      ADD COLUMN IF NOT EXISTS commission_status commission_status NOT NULL DEFAULT 'cleared';
    """,

    # ── 5. Commission hold + debt columns on users ─────────────────────────
    """
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS commission_held_kobo BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS commission_debt_kobo  BIGINT NOT NULL DEFAULT 0;
    """,

    # ── 6. promo_banners: impressions + clicks (already added in code but ensure DB has them) ─
    """
    ALTER TABLE promo_banners
      ADD COLUMN IF NOT EXISTS impressions INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS clicks     INTEGER NOT NULL DEFAULT 0;
    """,

    # ── 7. dispute_sla_hours + dispute_eligibility_window_hours in system_config ─
    """
    INSERT INTO system_config (key, value, description)
    VALUES
      ('dispute_sla_hours', '48', 'Hours after which an unresolved open/under-review dispute is auto-escalated to the director queue'),
      ('dispute_eligibility_window_hours', '72', 'Hours after a job goes successful during which a commission-hold dispute can still be filed. Past this window, disputes are rejected.')
    ON CONFLICT (key) DO NOTHING;
    """,

    # ── 8. RLS bypass for new columns (Supabase service role) ─────────────
    """
    DROP POLICY IF EXISTS "service_role_bypass_dispute_messages_internal" ON dispute_messages;
    """,
]

async def main():
    print("Applying migration 038 (dispute overhaul + commission hold)...", flush=True)
    async with engine.connect() as conn:
        for i, stmt in enumerate(STATEMENTS, 1):
            stmt_clean = stmt.strip()
            if not stmt_clean:
                continue
            print(f"  [{i}/{len(STATEMENTS)}] {stmt_clean[:60].replace(chr(10), ' ')}...", flush=True)
            await conn.execute(text(stmt_clean))
        await conn.commit()
    print("SUCCESS: Migration 038 applied!", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
