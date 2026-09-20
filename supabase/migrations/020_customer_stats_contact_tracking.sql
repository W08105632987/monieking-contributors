-- 020_customer_stats_contact_tracking.sql
-- Supports the new Customer Statistics feature (director dashboard,
-- officer dashboard "See more" detail page). Every other number that
-- feature shows (active/inactive counts, food/regular split, new
-- contributors, per-officer contribution totals) is computed on the fly
-- from existing tables — this is the one genuinely new piece of state:
-- officers need a way to record "I already called this customer" so a
-- contacted-but-not-yet-paying customer doesn't look identical to one
-- nobody has reached out to yet.

ALTER TABLE users
  ADD COLUMN last_contacted_at TIMESTAMPTZ;

-- Only officers ever set this, and only for their own zone's customers,
-- but no CHECK constraint for that here — enforced at the application
-- layer (see customer_stats_service.py) the same way managing_officer_id
-- and other cross-role fields are, since a DB constraint can't see
-- "current user's role" at write time anyway.
COMMENT ON COLUMN users.last_contacted_at IS
  'Last time an officer tapped "mark as contacted" for this customer from the inactive-customers list. NULL = never contacted.';
