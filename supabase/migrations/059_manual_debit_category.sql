-- 059: a transaction type for manual debits by a director, so they are never mixed up with service charges or withdrawals.
ALTER TYPE tx_category ADD VALUE IF NOT EXISTS 'manual_debit';
