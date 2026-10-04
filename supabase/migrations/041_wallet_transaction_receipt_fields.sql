-- Migration 041: Universal Receipt — generalized transaction linkage
--
-- wallet_transactions only has related_card_id and related_withdrawal_id,
-- which cover two of the many actual transaction sources in this app
-- (manual services, bill payments, wallet funding, SMS fees all have
-- nothing to link back to their source row). This adds a generalized
-- related_entity_type/related_entity_id pair so a receipt can look up
-- real structured detail for ANY transaction type, while keeping the
-- two legacy columns untouched for backward compatibility with old rows.

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS related_entity_id   UUID;

CREATE INDEX IF NOT EXISTS idx_wallet_tx_related_entity
  ON wallet_transactions (related_entity_type, related_entity_id)
  WHERE related_entity_type IS NOT NULL;

COMMENT ON COLUMN wallet_transactions.related_entity_type IS
  'Generalized source type for receipt lookups: contribution_card, withdrawal, manual_service_request, identity_service, bill_payment, wallet_funding, sms_fee. Legacy related_card_id/related_withdrawal_id remain for old rows.';
