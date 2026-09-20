-- 023_rls_coverage_gap.sql
--
-- CRITICAL, go-live-blocking finding from the pre-launch audit: eight
-- tables have existed since as far back as 001_initial_schema.sql with
-- ROW LEVEL SECURITY NEVER ENABLED AT ALL — not "enabled with a
-- permissive policy", genuinely never turned on:
--
--   zones, officer_credit_lines, system_config   (001, missed when
--                                                  002_row_level_security.sql
--                                                  covered every other
--                                                  001-schema table)
--   zone_assignments                              (012)
--   disputes, dispute_messages                     (013)
--   billers, bill_payment_requests                 (019)
--
-- Why this matters even though the FastAPI backend enforces its own
-- access control on every route: the frontend (apps/web) holds a
-- public Supabase anon key and talks to Supabase directly for two
-- things — Auth, and a Realtime subscription (see
-- useWithdrawalRealtime.ts). That anon key is not a secret; it ships
-- in the built JS bundle by design, the same way it does in every
-- Supabase app. Normally that's fine, because RLS is what stands
-- between "holds the anon key" and "can read/write your tables" via
-- Supabase's REST/Realtime API directly — completely bypassing the
-- FastAPI backend's own auth checks, zone scoping, and role checks
-- entirely. A table with RLS never enabled has none of that
-- protection: Postgres's default table grants apply instead, and
-- Supabase's standard project setup grants the `authenticated` role
-- broad access to `public` schema tables unless a project has gone out
-- of its way to revoke it. Concretely, before this migration, any
-- logged-in customer's JWT could plausibly be used to read every
-- dispute and dispute message platform-wide, every bill payment
-- request (with amounts, phone/meter numbers, and status), and every
-- business rate in system_config, directly via
-- `<project>.supabase.co/rest/v1/<table>` — none of it going through
-- the backend at all.
--
-- Policies below mirror the access rules already implemented in the
-- FastAPI routes for each of these entities (disputes.py, bill_payments.py,
-- zones.py, settings.py) — this migration doesn't invent new rules, it
-- makes the already-intended rules actually enforced at the database
-- layer too, not just in application code.

ALTER TABLE zones                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer_credit_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_assignments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE billers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_payment_requests ENABLE ROW LEVEL SECURITY;

-- ── zones — everyone signed in can see zone names (used all over the
-- UI for display); only admin/director can write, matching zones.py's
-- DirectorOrAdmin gate on create/delete/assign. ─────────────────────
CREATE POLICY "zones_select" ON zones FOR SELECT USING (
  current_user_role() IS NOT NULL
);
CREATE POLICY "zones_write" ON zones FOR ALL USING (
  current_user_role() IN ('admin', 'director')
);

-- ── officer_credit_lines — unused by the application backend today
-- (grepped: no model, no route references it), but "unused" is not
-- "safe to leave wide open" — deny-all-but-admin is the correct
-- default for a table nothing currently reads or writes. ────────────
CREATE POLICY "officer_credit_lines_admin_only" ON officer_credit_lines FOR ALL USING (
  current_user_role() = 'admin'
);

-- ── system_config — business rates/fees. Every signed-in user can
-- read (customers need to see current rates), only admin/director can
-- write — matches settings.py exactly. ──────────────────────────────
CREATE POLICY "system_config_select" ON system_config FOR SELECT USING (
  current_user_role() IS NOT NULL
);
CREATE POLICY "system_config_write" ON system_config FOR UPDATE USING (
  current_user_role() IN ('admin', 'director')
);

-- ── zone_assignments — coverage history. Admin/director see
-- everything; an officer sees their own history only — matches
-- users.py's get_officer_zone_history (DirectorOrAdmin today, but an
-- officer viewing their OWN history is a reasonable read the app may
-- want later, so this is intentionally a little more permissive than
-- the current backend route on the SELECT side only — never on
-- writes). ────────────────────────────────────────────────────────
CREATE POLICY "zone_assignments_select" ON zone_assignments FOR SELECT USING (
  officer_id = auth.uid()
  OR current_user_role() IN ('admin', 'director')
);
CREATE POLICY "zone_assignments_write" ON zone_assignments FOR ALL USING (
  current_user_role() IN ('admin', 'director')
);

-- ── disputes — raiser sees their own; assigned handler sees theirs;
-- admin/director see everything (the open queue plus every assigned
-- one) — matches disputes.py's list_disputes access logic. ──────────
CREATE POLICY "disputes_select" ON disputes FOR SELECT USING (
  raised_by = auth.uid()
  OR assigned_to = auth.uid()
  OR current_user_role() IN ('admin', 'director')
);
CREATE POLICY "disputes_insert" ON disputes FOR INSERT WITH CHECK (
  raised_by = auth.uid()
  OR current_user_role() IN ('admin', 'director', 'officer')
);
CREATE POLICY "disputes_update" ON disputes FOR UPDATE USING (
  assigned_to = auth.uid()
  OR current_user_role() IN ('admin', 'director')
);

-- ── dispute_messages — only participants (raiser, handler,
-- admin/director) can read or post — matches disputes.py's message
-- endpoints, which check dispute participation before allowing either. ──
CREATE POLICY "dispute_messages_select" ON dispute_messages FOR SELECT USING (
  dispute_id IN (
    SELECT id FROM disputes
    WHERE raised_by = auth.uid() OR assigned_to = auth.uid()
  )
  OR current_user_role() IN ('admin', 'director')
);
CREATE POLICY "dispute_messages_insert" ON dispute_messages FOR INSERT WITH CHECK (
  sender_id = auth.uid()
  AND (
    dispute_id IN (
      SELECT id FROM disputes
      WHERE raised_by = auth.uid() OR assigned_to = auth.uid()
    )
    OR current_user_role() IN ('admin', 'director')
  )
);

-- ── billers — public catalog data (which billers/products are
-- available to pay), no customer-specific information in this table
-- at all. Readable by anyone signed in; only admin/director toggle
-- active/price — matches bill_payments.py's list_billers (open to any
-- authenticated user) and identity_services.py's equivalent pattern. ──
CREATE POLICY "billers_select" ON billers FOR SELECT USING (
  current_user_role() IS NOT NULL
);
CREATE POLICY "billers_write" ON billers FOR UPDATE USING (
  current_user_role() IN ('admin', 'director')
);

-- ── bill_payment_requests — this is the one with real financial and
-- personal data (amounts, masked account references, tokens). Owner
-- sees their own; the officer who initiated it on their behalf sees
-- it too; admin/director see everything — matches bill_payments.py's
-- get_request (fixed for the same missing-ownership-check bug this
-- session found on the FastAPI side; this closes the identical gap at
-- the database layer). ──────────────────────────────────────────────
CREATE POLICY "bill_payment_requests_select" ON bill_payment_requests FOR SELECT USING (
  customer_id = auth.uid()
  OR officer_id = auth.uid()
  OR current_user_role() IN ('admin', 'director')
);
CREATE POLICY "bill_payment_requests_insert" ON bill_payment_requests FOR INSERT WITH CHECK (
  customer_id = auth.uid()
  OR current_user_role() IN ('admin', 'director', 'officer')
);
