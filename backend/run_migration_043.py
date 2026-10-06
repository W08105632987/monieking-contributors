"""
Migration 043: Real push notifications (Web Push / VAPID)

Creates push_subscriptions — a user can have several (phone + desktop).
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from sqlalchemy import text
from app.core.database import engine

STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS push_subscriptions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint     TEXT NOT NULL UNIQUE,
        p256dh_key   TEXT NOT NULL,
        auth_key     TEXT NOT NULL,
        user_agent   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
        ON push_subscriptions (user_id);
    """,
    "ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;",
    'DROP POLICY IF EXISTS "service_role_bypass_push_subscriptions" ON push_subscriptions;',
    """
    CREATE POLICY "service_role_bypass_push_subscriptions"
        ON push_subscriptions FOR ALL TO service_role USING (TRUE);
    """,
]


async def run():
    async with engine.begin() as conn:
        for i, stmt in enumerate(STATEMENTS, 1):
            print(f"[migration 043] running statement {i}/{len(STATEMENTS)}...")
            await conn.execute(text(stmt))
    print("[migration 043] done.")


if __name__ == "__main__":
    asyncio.run(run())
