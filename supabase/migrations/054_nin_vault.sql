-- 054: encrypted NIN on file (Fernet; never stored raw). Additive, idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS nin_encrypted TEXT;
