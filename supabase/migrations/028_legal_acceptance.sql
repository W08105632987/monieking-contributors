-- 028_legal_acceptance.sql
-- Records WHEN a user accepted the Terms of Service and Privacy Policy,
-- and WHICH version — not just a frontend checkbox that blocks a submit
-- button and then forgets it happened. For a financial app collecting
-- BVN/NIN, this needs to be a real, auditable record, not a UI-only gate.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_accepted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_accepted_version  TEXT;

COMMENT ON COLUMN users.terms_accepted_at IS
  'When this user accepted the Terms of Service and Privacy Policy at registration. NULL means never (pre-existing accounts from before this was added).';
COMMENT ON COLUMN users.terms_accepted_version IS
  'Which document version was accepted — see LEGAL_DOCUMENT_VERSION in the frontend legal pages. Lets you tell who accepted an older version if the documents are ever revised.';
