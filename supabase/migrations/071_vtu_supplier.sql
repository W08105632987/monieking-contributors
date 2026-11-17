-- 071: GYKDATASUB as a second supplier for airtime and data ("VTU" plans).
--  billers.provider              which supplier a product is sold through ('monnify' = every existing row, 'vtu' = GYKDATASUB plans)
--  bill_payment_requests.provider           which supplier ACTUALLY served the purchase (differs from the biller's when a backup took over)
--  bill_payment_requests.provider_reference the supplier's own transaction reference
--  bill_payment_requests.failed_over_from   set when the first-choice supplier was down and the other one served the purchase
ALTER TABLE billers ADD COLUMN IF NOT EXISTS provider VARCHAR(10) NOT NULL DEFAULT 'monnify' CHECK (provider IN ('monnify', 'vtu'));
CREATE INDEX IF NOT EXISTS ix_billers_provider ON billers (provider);

ALTER TABLE bill_payment_requests ADD COLUMN IF NOT EXISTS provider VARCHAR(10) NOT NULL DEFAULT 'monnify' CHECK (provider IN ('monnify', 'vtu'));
ALTER TABLE bill_payment_requests ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(120);
ALTER TABLE bill_payment_requests ADD COLUMN IF NOT EXISTS failed_over_from VARCHAR(10);
CREATE INDEX IF NOT EXISTS ix_bill_requests_provider_ref ON bill_payment_requests (provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bill_requests_provider_completed ON bill_payment_requests (provider, completed_at) WHERE status = 'completed';
