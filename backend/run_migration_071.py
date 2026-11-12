"""
Migration 071: two kinds of service worker.
  users.worker_type                       'affiliated' (commission earner with a wallet) | 'company' (no wallet, no commission)
  manual_service_requests.worker_type     snapshot of the type that completed the job, so reassignment never rewrites profit
Additive and idempotent. Every existing service worker becomes 'affiliated', exactly as they work today.
RUN THIS BEFORE deploying the code that reads these columns.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from sqlalchemy import text
from app.core.database import engine

STATEMENTS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS worker_type VARCHAR(10);",
    "UPDATE users SET worker_type = 'affiliated' WHERE role::text = 'service_worker' AND worker_type IS NULL;",
    "ALTER TABLE manual_service_requests ADD COLUMN IF NOT EXISTS worker_type VARCHAR(10);",
]


async def run():
    async with engine.begin() as conn:
        for i, stmt in enumerate(STATEMENTS, 1):
            print(f"[migration 071] running statement {i}/{len(STATEMENTS)}...")
            await conn.execute(text(stmt))
    print("[migration 071] done.")


if __name__ == "__main__":
    asyncio.run(run())
