-- ================================================================
-- MonieKing Contributors
-- Migration: 008_card_number.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001–007.
--
-- Adds a short, human-friendly sequential "card_number" to
-- contribution_cards (e.g. 1000, 1001, 1002 ...) so customers/officers/
-- directors see a decent number in the URL bar and on screen — instead
-- of the raw UUID primary key (e.g.
-- b8cef0f0-2bbe-4ba3-9a15-08b09bf998ff). The UUID `id` column remains
-- the real primary key everywhere internally (foreign keys, API request
-- bodies, etc.) — card_number is purely a public-facing identifier.
-- ================================================================

-- Starts at 1000 so even the very first card in the system reads as a
-- normal-looking 4-digit number rather than "Card #1".
CREATE SEQUENCE IF NOT EXISTS card_number_seq START WITH 1000;

ALTER TABLE contribution_cards
  ADD COLUMN IF NOT EXISTS card_number INTEGER;

-- Backfill any existing cards, oldest first, so card numbers roughly
-- track creation order.
WITH numbered AS (
  SELECT id, nextval('card_number_seq') AS n
  FROM contribution_cards
  WHERE card_number IS NULL
  ORDER BY created_at
)
UPDATE contribution_cards c
SET card_number = numbered.n
FROM numbered
WHERE c.id = numbered.id;

ALTER TABLE contribution_cards
  ALTER COLUMN card_number SET DEFAULT nextval('card_number_seq'),
  ALTER COLUMN card_number SET NOT NULL;

ALTER TABLE contribution_cards
  ADD CONSTRAINT contribution_cards_card_number_key UNIQUE (card_number);

CREATE INDEX IF NOT EXISTS idx_contribution_cards_card_number
  ON contribution_cards(card_number);
