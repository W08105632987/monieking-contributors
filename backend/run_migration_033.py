import asyncio
from sqlalchemy import text
from app.core.database import engine

SQL = """
CREATE OR REPLACE FUNCTION prevent_self_privilege_escalation()
RETURNS TRIGGER AS $$
BEGIN
  -- Backend server: direct Postgres connection (postgres / service_role / no JWT context)
  -- or Supabase service_role JWT — fully trusted, not subject to this check.
  IF CURRENT_USER IN ('postgres', 'service_role') 
     OR SESSION_USER IN ('postgres', 'service_role')
     OR auth.role() = 'service_role' 
     OR auth.role() IS NULL THEN
    RETURN NEW;
  END IF;

  -- An admin or director acting through their own authenticated session (not the
  -- service role) is allowed to change these — e.g. an admin-facing
  -- flow that updates a user's role directly under RLS rather than
  -- through the backend.
  IF current_user_role() IN ('admin', 'director') THEN
    RETURN NEW;
  END IF;

  -- Privilege / account state
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Not permitted to change role';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Not permitted to change status';
  END IF;

  -- Management assignment
  IF NEW.zone_id IS DISTINCT FROM OLD.zone_id THEN
    RAISE EXCEPTION 'Not permitted to change zone assignment';
  END IF;
  IF NEW.managing_officer_id IS DISTINCT FROM OLD.managing_officer_id THEN
    RAISE EXCEPTION 'Not permitted to change managing officer';
  END IF;
  IF NEW.is_manual_customer IS DISTINCT FROM OLD.is_manual_customer THEN
    RAISE EXCEPTION 'Not permitted to change is_manual_customer';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Not permitted to change created_by';
  END IF;
  IF NEW.customer_number IS DISTINCT FROM OLD.customer_number THEN
    RAISE EXCEPTION 'Not permitted to change customer_number';
  END IF;

  -- Credentials — must only ever be set via the backend's proper
  -- hashing/verification flows, never a direct column write.
  IF NEW.login_password_hash IS DISTINCT FROM OLD.login_password_hash THEN
    RAISE EXCEPTION 'Not permitted to change login_password_hash directly';
  END IF;
  IF NEW.withdrawal_password_hash IS DISTINCT FROM OLD.withdrawal_password_hash THEN
    RAISE EXCEPTION 'Not permitted to change withdrawal_password_hash directly';
  END IF;

  -- Lockout / brute-force counters — a user must not be able to clear
  -- their own lockout state.
  IF NEW.login_failed_attempts IS DISTINCT FROM OLD.login_failed_attempts THEN
    RAISE EXCEPTION 'Not permitted to change login_failed_attempts';
  END IF;
  IF NEW.login_locked_until IS DISTINCT FROM OLD.login_locked_until THEN
    RAISE EXCEPTION 'Not permitted to change login_locked_until';
  END IF;
  IF NEW.login_lockout_level IS DISTINCT FROM OLD.login_lockout_level THEN
    RAISE EXCEPTION 'Not permitted to change login_lockout_level';
  END IF;
  IF NEW.withdrawal_password_failed_attempts IS DISTINCT FROM OLD.withdrawal_password_failed_attempts THEN
    RAISE EXCEPTION 'Not permitted to change withdrawal_password_failed_attempts';
  END IF;
  IF NEW.withdrawal_password_locked_until IS DISTINCT FROM OLD.withdrawal_password_locked_until THEN
    RAISE EXCEPTION 'Not permitted to change withdrawal_password_locked_until';
  END IF;

  -- Identity verification status — must only change as a result of an
  -- actual verification call, never a self-reported column write.
  IF NEW.bvn_linked IS DISTINCT FROM OLD.bvn_linked THEN
    RAISE EXCEPTION 'Not permitted to change bvn_linked directly';
  END IF;
  IF NEW.nin_linked IS DISTINCT FROM OLD.nin_linked THEN
    RAISE EXCEPTION 'Not permitted to change nin_linked directly';
  END IF;
  IF NEW.bvn_last4 IS DISTINCT FROM OLD.bvn_last4 THEN
    RAISE EXCEPTION 'Not permitted to change bvn_last4 directly';
  END IF;
  IF NEW.nin_last4 IS DISTINCT FROM OLD.nin_last4 THEN
    RAISE EXCEPTION 'Not permitted to change nin_last4 directly';
  END IF;
  IF NEW.kyc_completed_at IS DISTINCT FROM OLD.kyc_completed_at THEN
    RAISE EXCEPTION 'Not permitted to change kyc_completed_at directly';
  END IF;

  -- Internal auth-flow secrets/state (2FA, WebAuthn, password reset)
  IF NEW.two_factor_otp_hash IS DISTINCT FROM OLD.two_factor_otp_hash THEN
    RAISE EXCEPTION 'Not permitted to change two_factor_otp_hash directly';
  END IF;
  IF NEW.two_factor_otp_expires_at IS DISTINCT FROM OLD.two_factor_otp_expires_at THEN
    RAISE EXCEPTION 'Not permitted to change two_factor_otp_expires_at directly';
  END IF;
  IF NEW.login_password_reset_otp_hash IS DISTINCT FROM OLD.login_password_reset_otp_hash THEN
    RAISE EXCEPTION 'Not permitted to change login_password_reset_otp_hash directly';
  END IF;
  IF NEW.webauthn_challenge IS DISTINCT FROM OLD.webauthn_challenge THEN
    RAISE EXCEPTION 'Not permitted to change webauthn_challenge directly';
  END IF;
  IF NEW.webauthn_challenge_expires_at IS DISTINCT FROM OLD.webauthn_challenge_expires_at THEN
    RAISE EXCEPTION 'Not permitted to change webauthn_challenge_expires_at directly';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""

async def main():
    print("Applying migration 033...", flush=True)
    async with engine.connect() as conn:
        await conn.execute(text(SQL))
        await conn.commit()
    print("Migration 033 applied successfully!", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
