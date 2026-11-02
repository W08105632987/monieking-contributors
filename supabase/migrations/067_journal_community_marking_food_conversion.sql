-- 067: Director journal, WhatsApp community gate, marking corrections, food-card conversion reminders,
--      and the fix for "something went wrong" when a customer is registered with more than one card.
-- Additive and idempotent: safe to run twice.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) FIX: a customer with two cards of the SAME type could not be registered.
--    Migration 051 made (phone_number, card_type) unique for waiting cards, but the code (and the Excel
--    template) are built to allow many cards, even of the same type. The second card hit this index and the
--    API answered with the generic "something went wrong".
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS uq_pending_offline_phone_card;
CREATE INDEX IF NOT EXISTS ix_pending_offline_phone_card
  ON pending_offline_customers (phone_number, card_type) WHERE claimed_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Director journal: one row for every action a director or admin carries out.
--    Written automatically by the API for every state-changing request, so nothing can be forgotten.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS director_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_name    VARCHAR(200) NOT NULL,
  method        VARCHAR(8)   NOT NULL,
  path          TEXT         NOT NULL,
  route         TEXT,
  label         VARCHAR(160) NOT NULL,
  category      VARCHAR(40)  NOT NULL DEFAULT 'general',
  sensitive     BOOLEAN      NOT NULL DEFAULT FALSE,
  target_id     UUID,
  target_name   VARCHAR(200),
  details       JSONB,
  status_code   INTEGER      NOT NULL,
  ip_address    VARCHAR(45),
  user_agent    TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_director_activity_actor_day ON director_activity (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_director_activity_created   ON director_activity (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_director_activity_target    ON director_activity (target_id) WHERE target_id IS NOT NULL;

ALTER TABLE director_activity ENABLE ROW LEVEL SECURITY;   -- API (service role) only, like audit_logs

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) WhatsApp community gate: a customer must press "Join" once before seeing their dashboard.
--    NULL = has not confirmed yet. Set only when the server receives the join tap.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_joined_at TIMESTAMPTZ;

INSERT INTO system_config (key, value, description) VALUES
  ('community.whatsapp_title',   'Join the MonieKing family 🎉', 'Heading of the WhatsApp community pop-up customers see once.'),
  ('community.whatsapp_message', 'Welcome to MonieKing! Join all MonieKing customers worldwide in our WhatsApp group so you never feel alone on your contribution journey. Get updates, tips and support from the community.', 'Message of the WhatsApp community pop-up.'),
  ('community.whatsapp_button',  'Join WhatsApp group', 'Label of the join button.'),
  ('community.whatsapp_link',    '', 'WhatsApp group invite link (https://chat.whatsapp.com/...). Empty = the pop-up is switched off.'),
  ('support.phone',              '', 'Customer-support phone number shown on "Contact support" buttons across the app.'),
  ('support.whatsapp',           '2348038995252', 'Customer-support WhatsApp number (digits, with country code). Kept from the number that was built into the app.')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Marking corrections: an officer disputes a wrong marking; a director fixes the card.
--    Reuses the existing dispute chat so everyone can talk until it is resolved.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE dispute_entity_type ADD VALUE IF NOT EXISTS 'contribution_marking';
ALTER TYPE dispute_reason      ADD VALUE IF NOT EXISTS 'over_marked';
ALTER TYPE dispute_reason      ADD VALUE IF NOT EXISTS 'wrong_card_marked';

ALTER TABLE disputes ADD COLUMN IF NOT EXISTS marking_ref VARCHAR(100);   -- reference of the posting being disputed
CREATE INDEX IF NOT EXISTS ix_disputes_marking_ref ON disputes (marking_ref) WHERE marking_ref IS NOT NULL;

-- Everything a director removes from a card is kept here, so the correction can always be audited.
CREATE TABLE IF NOT EXISTS marking_corrections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id       UUID REFERENCES disputes(id) ON DELETE SET NULL,
  card_id          UUID NOT NULL REFERENCES contribution_cards(id) ON DELETE CASCADE,
  corrected_by     UUID NOT NULL REFERENCES users(id),
  officer_id       UUID REFERENCES users(id),
  mode             VARCHAR(20) NOT NULL,             -- 'remove_days' | 'remove_all'
  days_removed     INTEGER     NOT NULL,
  amount_kobo      BIGINT      NOT NULL,
  refund_reference VARCHAR(100),
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_marking_corrections_card ON marking_corrections (card_id);
ALTER TABLE marking_corrections ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Food card conversion: deadline + editable reminder text.
--    (The deadline also appears in Business Settings > Contribution Cards.)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO system_config (key, value, description) VALUES
  ('food_card_conversion_deadline', '2026-11-30', 'Last day to finish a Food Card. After this date every unfinished Food Card becomes a Regular Card automatically.'),
  ('food_conversion.reminder_template',
   'Hello {name}, your Food Card #{card_number} has {days_done} of {total_days} days done. Please complete it before {deadline} ({days_left} days left). If it is not complete by then, it will be converted to a Regular Card and you will lose your food package for that card.',
   'Message directors send to food contributors who have not finished their card. Placeholders: {name} {card_number} {days_done} {total_days} {days_left} {deadline}.')
ON CONFLICT (key) DO NOTHING;

-- Who has been reminded, and when (so a director can see it and avoid pinging twice by accident).
CREATE TABLE IF NOT EXISTS food_conversion_reminders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id     UUID REFERENCES contribution_cards(id) ON DELETE SET NULL,
  sent_by     UUID NOT NULL REFERENCES users(id),
  channel     VARCHAR(12) NOT NULL DEFAULT 'in_app',
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_food_reminders_customer ON food_conversion_reminders (customer_id, created_at DESC);
ALTER TABLE food_conversion_reminders ENABLE ROW LEVEL SECURITY;

-- Cards converted automatically (so the director can see what the job did).
ALTER TABLE contribution_cards ADD COLUMN IF NOT EXISTS auto_converted_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Cooperative dividend disputes get a two-way conversation, like every other dispute.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coop_dividend_dispute_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  UUID NOT NULL REFERENCES coop_dividend_disputes(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id),
  sender_role VARCHAR(20) NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_coop_div_dispute_msgs ON coop_dividend_dispute_messages (dispute_id, created_at);
ALTER TABLE coop_dividend_dispute_messages ENABLE ROW LEVEL SECURITY;
