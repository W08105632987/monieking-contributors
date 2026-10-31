-- 063: the director can rename the wallet-funding fee line customers see (default "NIPPS charge"). Additive, safe to re-run.
ALTER TABLE funding_fee_settings ADD COLUMN IF NOT EXISTS fee_label VARCHAR(40) NOT NULL DEFAULT 'NIPPS charge';
