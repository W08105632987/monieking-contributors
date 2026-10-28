-- 058: accounts whose password MonieKing set (director reset, or registered by an officer/director) are flagged so the
-- app asks for a new password at every login until the person chooses their own. Additive, idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
