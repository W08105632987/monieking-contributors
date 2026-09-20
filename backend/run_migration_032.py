import asyncio
import os
import sys
from sqlalchemy import text
from app.core.database import engine

STATEMENTS = [
    # 1. Drop check constraint on wallets
    "ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_balance_kobo_check",
    # 2. Add 'sms_fee' to tx_category
    """
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumtypid = 'tx_category'::regtype 
          AND enumlabel = 'sms_fee'
      ) THEN
        ALTER TYPE tx_category ADD VALUE 'sms_fee';
      END IF;
    END $$;
    """,
    # 3. Add column to users
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE",
    "CREATE INDEX IF NOT EXISTS idx_users_sms_alerts ON users(sms_alerts_enabled) WHERE sms_alerts_enabled = TRUE",
    # 4. Insert config key
    """
    INSERT INTO system_config (key, value, description) VALUES
      ('monthly_sms_fee_kobo', '10000', 'Monthly subscription fee charged to customers who opt into SMS transaction alerts, in kobo (e.g. 10000 = ₦100). Debited automatically at the end of the month.')
    ON CONFLICT (key) DO NOTHING;
    """
]

async def main():
    print("Applying migration 032 statements...", flush=True)
    async with engine.connect() as conn:
        for idx, stmt in enumerate(STATEMENTS, 1):
            print(f"Executing statement {idx}...", flush=True)
            await conn.execute(text(stmt))
            await conn.commit()
    print("Migration 032 successfully applied!", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
