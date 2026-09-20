-- 032_sms_subscription_and_wallet_overdraft.sql
-- Enables Director-configured monthly SMS alert fees, customer/officer activation,
-- and allows wallets to enter negative balances during monthly fee debits,
-- which clear automatically when the customer next funds their wallet.

-- 1. Relax wallet balance non-negative check to permit overdraft for SMS debit
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_balance_kobo_check;

-- 2. Add 'sms_fee' transaction category to enum if not already present
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

-- 3. Add sms_alerts_enabled column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_sms_alerts ON users(sms_alerts_enabled) WHERE sms_alerts_enabled = TRUE;

-- 4. Seed default monthly SMS fee in system_config (10,000 kobo = ₦100 / month)
INSERT INTO system_config (key, value, description) VALUES
  ('monthly_sms_fee_kobo', '10000', 'Monthly subscription fee charged to customers who opt into SMS transaction alerts, in kobo (e.g. 10000 = ₦100). Debited automatically at the end of the month.')
ON CONFLICT (key) DO NOTHING;
