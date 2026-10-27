-- 056: offline-imported withdrawals now carry the normal withdrawal charge, so they count as company profit.
-- Before this, imported withdrawals were stored with charge 0, so director profit never grew when old cards were added.
-- Rule (same as live withdrawals): one day's rate per card month reached; imported days are 31 per month and the
-- withdrawn days are always the first ones, so a withdrawal of W days charges rate * CEIL(W / 31).
-- Only rows that came from the import (bank 'Offline record', account '-') and still have charge 0 are touched,
-- and only when a positive amount is left to pay out. Re-running changes nothing.
UPDATE withdrawals w
   SET charge_kobo      = c.rate_kobo * CEIL((w.requested_amount_kobo / c.rate_kobo)::numeric / 31)::BIGINT,
       net_payable_kobo = w.requested_amount_kobo - c.rate_kobo * CEIL((w.requested_amount_kobo / c.rate_kobo)::numeric / 31)::BIGINT
  FROM contribution_cards c
 WHERE c.id = w.card_id
   AND w.bank_name = 'Offline record' AND w.account_number = '-' AND w.charge_kobo = 0
   AND c.rate_kobo > 0 AND w.requested_amount_kobo % c.rate_kobo = 0
   AND w.requested_amount_kobo - c.rate_kobo * CEIL((w.requested_amount_kobo / c.rate_kobo)::numeric / 31)::BIGINT > 0;
