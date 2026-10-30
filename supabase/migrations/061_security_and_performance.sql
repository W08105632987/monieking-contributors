-- 061: lock the public API, add missing indexes, drop duplicate indexes.
-- Additive and safe to re-run. Runs as ONE transaction (see backend/run_migration_061.py).

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A. SECURITY (finding D-02): about 40 tables had Row Level Security OFF.
--    Supabase publishes every table in the `public` schema through its REST API to anyone who holds the
--    "anon" key — and that key is, by design, shipped inside the web app. A table without RLS can therefore be read
--    (and changed) by anyone on the internet who copies the key from the page. Tables hit: the whole cooperative
--    money book, member bank details, the waiting list of customers (names + phone numbers), KYC lookups, expenses,
--    fee settings and more.
--    The backend connects with its own database login (which is not affected by RLS), so turning RLS on with no
--    policies simply means: the browser's public key can no longer touch these tables at all.
--    Tables that already have RLS and policies are left exactly as they are.
-- ─────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', r.relname);
    RAISE NOTICE 'RLS enabled on %', r.relname;
  END LOOP;
END
$$;

-- The anonymous (logged-out) key should never touch application data. Existing policies on the Supabase-auth based
-- tables keep working for signed-in users; this only removes the logged-out door.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND c.relname NOT IN ('analytics_events')   -- the page-view tracker inserts through the API on purpose
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', r.relname);
  END LOOP;
END
$$;

-- Tables created from now on are NOT reachable by the public keys unless somebody grants access on purpose.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- B. PERFORMANCE: indexes for the queries that run all day (lists per customer, newest first, queues).
-- ─────────────────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_created ON wallet_transactions (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contrib_records_contributed_by ON contribution_records (contributed_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_customer_requested ON withdrawals (customer_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_requested ON withdrawals (status, requested_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs (entity_id);
CREATE INDEX IF NOT EXISTS idx_users_role_created ON users (role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_records_user ON funding_records (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_requests_status_created ON bill_payment_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_offline_claimed_user ON pending_offline_customers (claimed_user_id) WHERE claimed_user_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- C. Duplicate indexes: every extra index slows every write (each login, contribution and payment). These pairs
--    index the same columns; the "ix_" copy is dropped ONLY if its "idx_" twin exists, so nothing is ever left
--    without an index.
-- ─────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE pair text[];
DECLARE pairs text[][] := ARRAY[
  ['ix_notifications_user_id',          'idx_notifications_user_id'],
  ['ix_notifications_user_unread',      'idx_notifications_is_read'],
  ['ix_withdrawals_status',             'idx_withdrawals_status'],
  ['ix_withdrawals_customer_id',        'idx_withdrawals_customer_id'],
  ['ix_contribution_records_card_id',   'idx_contrib_records_card_id'],
  ['ix_contribution_cards_owner_id',    'idx_cards_owner_id'],
  ['ix_contribution_cards_status',      'idx_cards_status'],
  ['ix_wallet_transactions_wallet_id',  'idx_wallet_tx_wallet_id'],
  ['ix_wallets_owner_id',               'idx_wallets_owner_id'],
  ['ix_users_zone_id',                  'idx_users_zone_id'],
  ['ix_users_role',                     'idx_users_role'],
  ['ix_users_status',                   'idx_users_status']
];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY pairs LOOP
    IF to_regclass('public.' || pair[1]) IS NOT NULL AND to_regclass('public.' || pair[2]) IS NOT NULL THEN
      EXECUTE format('DROP INDEX public.%I', pair[1]);
    END IF;
  END LOOP;
END
$$;
