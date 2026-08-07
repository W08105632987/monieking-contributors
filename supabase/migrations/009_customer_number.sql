-- ================================================================
-- MonieKing Contributors
-- Migration: 009_customer_number.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001–008.
--
-- Adds a short, human-friendly sequential "customer_number" to users
-- (e.g. 1000, 1001, 1002 ...), mirroring what 008_card_number.sql did
-- for cards. Officer/director portals show and link to customers by
-- this number instead of the raw UUID `id` — e.g.
-- /officer/customers/1024 instead of
-- /officer/customers/28816024-feed-4416-90a3-65860314fc6a.
--
-- Assigned to EVERY user row (customers, officers, directors alike) —
-- simpler than a conditional trigger, and future-proofs officer/staff
-- detail pages if they ever want the same treatment. The UUID `id`
-- column remains the real primary key everywhere internally.
-- ================================================================

CREATE SEQUENCE IF NOT EXISTS customer_number_seq START WITH 1000;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS customer_number INTEGER;

WITH numbered AS (
  SELECT id, nextval('customer_number_seq') AS n
  FROM users
  WHERE customer_number IS NULL
  ORDER BY created_at
)
UPDATE users u
SET customer_number = numbered.n
FROM numbered
WHERE u.id = numbered.id;

ALTER TABLE users
  ALTER COLUMN customer_number SET DEFAULT nextval('customer_number_seq'),
  ALTER COLUMN customer_number SET NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_customer_number_key UNIQUE (customer_number);

CREATE INDEX IF NOT EXISTS idx_users_customer_number
  ON users(customer_number);
