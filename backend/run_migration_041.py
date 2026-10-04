"""
Migration 041: Universal Receipt — generalized transaction linkage

Changes:
  1. Add related_entity_type / related_entity_id to wallet_transactions
  2. Index them for fast receipt lookups
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from sqlalchemy import text
from app.core.database import engine

STATEMENTS = [
    """
    ALTER TABLE wallet_transactions
      ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(40),
      ADD COLUMN IF NOT EXISTS related_entity_id   UUID;
    """,

    """
    CREATE INDEX IF NOT EXISTS idx_wallet_tx_related_entity
      ON wallet_transactions (related_entity_type, related_entity_id)
      WHERE related_entity_type IS NOT NULL;
    """,
]


async def run():
    async with engine.begin() as conn:
        for i, stmt in enumerate(STATEMENTS, 1):
            print(f"[migration 041] running statement {i}/{len(STATEMENTS)}...")
            await conn.execute(text(stmt))
    print("[migration 041] done.")


if __name__ == "__main__":
    asyncio.run(run())
