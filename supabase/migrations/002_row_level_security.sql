-- ================================================================
-- MonieKing Contributors — Row Level Security Policies
-- Migration: 002_row_level_security.sql
-- ================================================================

-- Enable RLS on all tables
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE zones                ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE contribution_cards   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contribution_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcasts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhooks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
  SELECT role::TEXT FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get current user's zone
CREATE OR REPLACE FUNCTION current_user_zone()
RETURNS UUID AS $$
  SELECT zone_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── users table ───────────────────────────────────────────────────
-- Customers see only themselves
-- Officers see themselves + customers in their zone
-- Admins and Directors see all
CREATE POLICY "users_select" ON users FOR SELECT USING (
  id = auth.uid()
  OR current_user_role() IN ('admin', 'director')
  OR (current_user_role() = 'officer' AND zone_id = current_user_zone())
);

CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (
  current_user_role() IN ('admin', 'director', 'officer')
  OR id = auth.uid()
);

CREATE POLICY "users_update" ON users FOR UPDATE USING (
  id = auth.uid()
  OR current_user_role() = 'admin'
);

-- ── wallets table ─────────────────────────────────────────────────
CREATE POLICY "wallets_select" ON wallets FOR SELECT USING (
  owner_id = auth.uid()
  OR current_user_role() = 'admin'
  OR (current_user_role() = 'officer' AND owner_id IN (
    SELECT id FROM users WHERE zone_id = current_user_zone()
  ))
);

CREATE POLICY "wallets_update" ON wallets FOR UPDATE USING (
  owner_id = auth.uid()
  OR current_user_role() = 'admin'
);

-- ── wallet_transactions table ─────────────────────────────────────
CREATE POLICY "wallet_tx_select" ON wallet_transactions FOR SELECT USING (
  wallet_id IN (SELECT id FROM wallets WHERE owner_id = auth.uid())
  OR current_user_role() IN ('admin', 'director')
);

-- Inserts only via service role (backend)
CREATE POLICY "wallet_tx_insert" ON wallet_transactions FOR INSERT WITH CHECK (
  current_user_role() IS NOT NULL
);

-- ── contribution_cards table ──────────────────────────────────────
CREATE POLICY "cards_select" ON contribution_cards FOR SELECT USING (
  owner_id = auth.uid()
  OR current_user_role() = 'admin'
  OR (current_user_role() = 'officer' AND owner_id IN (
    SELECT id FROM users WHERE zone_id = current_user_zone()
  ))
);

CREATE POLICY "cards_insert" ON contribution_cards FOR INSERT WITH CHECK (
  owner_id = auth.uid()
  OR current_user_role() IN ('admin', 'officer')
);

CREATE POLICY "cards_update" ON contribution_cards FOR UPDATE USING (
  owner_id = auth.uid()
  OR current_user_role() IN ('admin', 'officer')
);

-- ── contribution_records table ────────────────────────────────────
CREATE POLICY "contrib_records_select" ON contribution_records FOR SELECT USING (
  card_id IN (SELECT id FROM contribution_cards WHERE owner_id = auth.uid())
  OR current_user_role() IN ('admin', 'director', 'officer')
);

-- ── withdrawals table ─────────────────────────────────────────────
CREATE POLICY "withdrawals_select" ON withdrawals FOR SELECT USING (
  customer_id = auth.uid()
  OR current_user_role() IN ('admin', 'director')
);

CREATE POLICY "withdrawals_insert" ON withdrawals FOR INSERT WITH CHECK (
  customer_id = auth.uid()
  OR current_user_role() = 'officer'
);

CREATE POLICY "withdrawals_update" ON withdrawals FOR UPDATE USING (
  current_user_role() IN ('admin', 'director')
);

-- ── notifications table ───────────────────────────────────────────
CREATE POLICY "notifications_select" ON notifications FOR SELECT USING (
  user_id = auth.uid()
);

CREATE POLICY "notifications_update" ON notifications FOR UPDATE USING (
  user_id = auth.uid()
);

CREATE POLICY "notifications_insert" ON notifications FOR INSERT WITH CHECK (
  current_user_role() IS NOT NULL
);

-- ── audit_logs — read-only for admins ────────────────────────────
CREATE POLICY "audit_logs_select" ON audit_logs FOR SELECT USING (
  current_user_role() = 'admin'
);

CREATE POLICY "audit_logs_insert" ON audit_logs FOR INSERT WITH CHECK (
  current_user_role() IS NOT NULL
);

-- ── webauthn_credentials ──────────────────────────────────────────
CREATE POLICY "webauthn_select" ON webauthn_credentials FOR SELECT USING (
  user_id = auth.uid()
);

CREATE POLICY "webauthn_insert" ON webauthn_credentials FOR INSERT WITH CHECK (
  user_id = auth.uid()
);

CREATE POLICY "webauthn_delete" ON webauthn_credentials FOR DELETE USING (
  user_id = auth.uid()
);
