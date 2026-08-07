import uuid
import httpx
from fastapi import HTTPException
from app.core.config import get_settings

settings = get_settings()


async def create_supabase_auth_user(*, email: str, password: str, full_name: str, phone: str) -> uuid.UUID:
    """
    Creates a real Supabase Auth login via the Admin API and returns its id.
    Every platform user (Customer, Officer, Director) MUST go through this —
    a `users` row without a matching auth.users row can never log in.
    """
    from app.utils.supabase_admin_client import supabase_admin_request

    resp = await supabase_admin_request(
        "POST",
        "/auth/v1/admin/users",
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": full_name, "phone": phone},
        },
        failure_detail="Could not create your account right now. Please try again in a moment.",
    )
    return uuid.UUID(resp.json()["id"])


async def generate_session_for_user(email: str) -> dict:
    """
    Used only after a WebAuthn assertion has already been cryptographically
    verified — this does NOT re-check identity, it converts an
    already-proven identity into a real Supabase session (access_token +
    refresh_token), the same shape the frontend gets from a normal
    password login, so it can call supabase.auth.setSession() with it.

    Uses Supabase's admin "generate_link" (magiclink) + the returned
    email_otp to obtain a session server-side, without actually sending
    an email — this is a documented pattern for custom/passwordless auth
    layered on top of Supabase Auth. NOTE: field names in the
    generate_link response have shifted across GoTrue versions in the
    past; this checks a couple of possible shapes defensively. Worth a
    real end-to-end test against your specific Supabase project.
    """
    from app.utils.supabase_admin_client import supabase_admin_request

    link_resp = await supabase_admin_request(
        "POST",
        "/auth/v1/admin/generate_link",
        json={"type": "magiclink", "email": email},
        failure_detail="Could not start your biometric session. Please try again.",
    )

    link_data = link_resp.json()
    email_otp = (
        link_data.get("email_otp")
        or link_data.get("properties", {}).get("email_otp")
        or link_data.get("hashed_token")
    )
    if not email_otp:
        raise HTTPException(status_code=502, detail="Passwordless session provider returned an unexpected response")

    verify_resp = await supabase_admin_request(
        "POST",
        "/auth/v1/verify",
        extra_headers={},
        json={"type": "magiclink", "email": email, "token": email_otp},
        failure_detail="Could not finish your biometric session. Please try again.",
    )

    session = verify_resp.json()
    if "access_token" not in session:
        raise HTTPException(status_code=502, detail="Passwordless session provider returned an unexpected response")

    return {
        "access_token":  session["access_token"],
        "refresh_token": session.get("refresh_token"),
    }
