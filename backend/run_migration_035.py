import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from sqlalchemy import text
from app.core.database import engine

SQL = """
INSERT INTO system_config (key, value, description) VALUES
  ('food_card_open_from',  '2026-01-01', 'Opening date for Food Card registration window (YYYY-MM-DD). Customers cannot open a Food Card before this date.'),
  ('food_card_open_until', '2026-11-30', 'Closing date for Food Card registration window (YYYY-MM-DD). Customers cannot open a Food Card after this date.')
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description;
"""

async def main():
    print("Applying migration 035...", flush=True)
    async with engine.connect() as conn:
        await conn.execute(text(SQL))
        await conn.commit()
    print("Migration 035 successfully applied!", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
