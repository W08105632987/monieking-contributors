-- 063: electricity receipts show the units bought (kWh) and the meter/customer address.
ALTER TABLE bill_payment_requests ADD COLUMN IF NOT EXISTS units VARCHAR(40);
ALTER TABLE bill_payment_requests ADD COLUMN IF NOT EXISTS customer_address VARCHAR(255);
