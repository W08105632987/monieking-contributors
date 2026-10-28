-- 060: director-controlled bill pricing + commission/profit tracking. Additive and idempotent.

ALTER TABLE billers ADD COLUMN IF NOT EXISTS commission_percent numeric(6,3) NOT NULL DEFAULT 0;
ALTER TABLE billers ADD COLUMN IF NOT EXISTS markup_percent numeric(6,3) NOT NULL DEFAULT 0;
ALTER TABLE billers ADD COLUMN IF NOT EXISTS customer_price_kobo bigint;
ALTER TABLE billers ADD COLUMN IF NOT EXISTS min_amount_kobo bigint;
ALTER TABLE billers ADD COLUMN IF NOT EXISTS max_amount_kobo bigint;

ALTER TABLE bill_payment_requests ADD COLUMN IF NOT EXISTS vend_amount_kobo bigint;
ALTER TABLE bill_payment_requests ADD COLUMN IF NOT EXISTS commission_kobo bigint NOT NULL DEFAULT 0;
ALTER TABLE bill_payment_requests ADD COLUMN IF NOT EXISTS markup_kobo bigint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bill_requests_completed ON bill_payment_requests (completed_at) WHERE status = 'completed';

-- Seed Monnify's commission sheet onto rows that have no rate yet (never overwrites a rate a director set).
UPDATE billers SET commission_percent = 3.0 WHERE commission_percent = 0 AND category IN ('airtime','data') AND name ILIKE '%mtn%';
UPDATE billers SET commission_percent = 3.0 WHERE commission_percent = 0 AND category IN ('airtime','data') AND name ILIKE '%airtel%';
UPDATE billers SET commission_percent = 5.0 WHERE commission_percent = 0 AND category IN ('airtime','data') AND name ILIKE '%glo%';
UPDATE billers SET commission_percent = 4.5 WHERE commission_percent = 0 AND category IN ('airtime','data') AND (name ILIKE '%9mobile%' OR name ILIKE '%etisalat%');
UPDATE billers SET commission_percent = 1.5 WHERE commission_percent = 0 AND category = 'cable_tv' AND (name ILIKE '%dstv%' OR name ILIKE '%gotv%' OR name ILIKE '%startimes%');
UPDATE billers SET commission_percent = 1.0 WHERE commission_percent = 0 AND category = 'electricity' AND name ILIKE '%eko%';
UPDATE billers SET commission_percent = 0.8 WHERE commission_percent = 0 AND category = 'electricity' AND name ILIKE '%ikeja%';
UPDATE billers SET commission_percent = 1.5 WHERE commission_percent = 0 AND category = 'electricity' AND name ILIKE '%abuja%';
UPDATE billers SET commission_percent = 1.8 WHERE commission_percent = 0 AND category = 'electricity' AND (name ILIKE '%benin%' OR name ILIKE 'bedc%');
UPDATE billers SET commission_percent = 1.8 WHERE commission_percent = 0 AND category = 'electricity' AND name ILIKE '%enugu%';
UPDATE billers SET commission_percent = 0.9 WHERE commission_percent = 0 AND category = 'electricity' AND name ILIKE '%ibadan%';
UPDATE billers SET commission_percent = 1.5 WHERE commission_percent = 0 AND category = 'electricity' AND name ILIKE '%jos%';
UPDATE billers SET commission_percent = 1.5 WHERE commission_percent = 0 AND category = 'electricity' AND name ILIKE '%kaduna%';
UPDATE billers SET commission_percent = 1.3 WHERE commission_percent = 0 AND category = 'electricity' AND name ILIKE '%kano%';
UPDATE billers SET commission_percent = 1.4 WHERE commission_percent = 0 AND category = 'electricity' AND name ILIKE '%port harcourt%';
UPDATE billers SET commission_percent = 1.5 WHERE commission_percent = 0 AND category = 'electricity' AND name ILIKE 'aba electricity%';
UPDATE billers SET commission_percent = 1.1 WHERE commission_percent = 0 AND category = 'electricity' AND name ILIKE '%yola%';

