-- 030_identity_service_official_document_note.sql
-- Drives the "is this an official document?" banner shown alongside any
-- identity-service result the customer can view or download a reference
-- for. NULL means no special note is needed for that service.
--
-- This exists because some services (NIN verification) have a REAL
-- official document issued only by a government body (NIMC), which no
-- verification API — Youverify, Dojah, or otherwise — can reissue. For
-- those, the note tells the customer how to get the real thing from the
-- issuing authority. For everything else (BVN, CAC, TIN), the note
-- clarifies that MonieKing's downloadable PDF is a verification
-- reference, not a substitute for an official certificate — so nobody
-- mistakes a MonieKing-generated summary for a government-issued one.

ALTER TABLE identity_services
  ADD COLUMN IF NOT EXISTS official_document_note TEXT;

COMMENT ON COLUMN identity_services.official_document_note IS
  'Customer-facing note clarifying what the result/reference PDF is and is not, relative to any real official document for this service. NULL = no note needed. Set per-service in seed_identity_services.py, not user-editable.';
