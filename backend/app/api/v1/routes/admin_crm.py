"""
Admin CRM routes (apps/admin — the desktop-only, admin-role-only
surface). Overview dashboard reuses the existing platform-wide
analytics/customer-stats endpoints directly (no new backend needed
there — see admin.py's /admin/analytics and customer_stats.py's
/customer-stats/overview); this file adds what's genuinely new:
Customer 360, wallet ledger, and reconciliation flags.
"""
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.dependencies import AdminOnly
from app.services import admin_crm_service as svc
from app.models.user import User
from app.utils.audit import log_action
from app.utils.supabase_admin_client import supabase_admin_request
from app.integrations.termii import send_sms
import secrets
import string

router = APIRouter(prefix="/admin/crm", tags=["admin-crm"])


@router.get("/customers")
async def list_customers(
    admin: AdminOnly,
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(None, description="Search by name, phone, or customer number"),
    page: int = 1,
    page_size: int = 25,
):
    customers, total = await svc.search_customers(db, query=q, page=page, page_size=page_size)
    return {
        "customers": [
            {
                "id": str(c.id),
                "customer_number": c.customer_number,
                "full_name": c.full_name,
                "phone_number": c.phone_number,
                "status": c.status.value,
                "zone_id": str(c.zone_id) if c.zone_id else None,
                "created_at": c.created_at,
            }
            for c in customers
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/customers/{user_ref}/full-profile")
async def get_customer_full_profile(
    admin: AdminOnly,
    user_ref: str,
    db: AsyncSession = Depends(get_db),
):
    profile = await svc.get_customer_full_profile(db, user_ref)
    if profile is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    return profile


@router.get("/wallet-transactions")
async def list_wallet_transactions(
    admin: AdminOnly,
    db: AsyncSession = Depends(get_db),
    user_ref: str | None = Query(None, description="Filter to one user's wallet — UUID or customer_number"),
    category: str | None = None,
    tx_type: str | None = Query(None, alias="type"),
    start_date: date | None = None,
    end_date: date | None = None,
    page: int = 1,
    page_size: int = 50,
):
    transactions, total = await svc.list_wallet_transactions(
        db, user_ref=user_ref, category=category, tx_type=tx_type,
        start_date=start_date, end_date=end_date, page=page, page_size=page_size,
    )
    return {"transactions": transactions, "total": total, "page": page, "page_size": page_size}


@router.get("/reconciliation-flags")
async def get_reconciliation_flags(
    admin: AdminOnly,
    db: AsyncSession = Depends(get_db),
):
    return {"flags": await svc.get_reconciliation_flags(db)}


def _generate_temp_password(length: int = 12) -> str:
    """A random password meeting Supabase's minimum requirements —
    length plus a mix of character classes — not meant to be memorable,
    since the person receiving it is expected to change it on next
    login, not keep using it."""
    alphabet = string.ascii_letters + string.digits
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(c.islower() for c in pw) and any(c.isupper() for c in pw) and any(c.isdigit() for c in pw):
            return pw


@router.post("/users/{user_id}/force-password-reset")
async def force_password_reset(
    admin: AdminOnly,
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Admin-initiated password reset — for a user who's locked out,
    lost access to their registered phone, or whose account is
    suspected compromised, and can't go through the normal self-service
    forgot-password OTP flow. Generates a random temporary password,
    sets it directly via the Supabase Admin API (same mechanism the
    self-service /auth/forgot-password/reset flow already uses), and
    SMS's it to the user's registered phone. The user should be told to
    change it immediately on next login — this endpoint doesn't force
    that itself (there's no "must change password" flag anywhere in
    this schema to hook into), so that expectation has to be set by
    whoever's handling the support case, not enforced by the system.
    """
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    temp_password = _generate_temp_password()

    await supabase_admin_request(
        "PUT",
        f"/auth/v1/admin/users/{user.id}",
        json={"password": temp_password},
        failure_detail="Couldn't reach the authentication service to reset this password. Please try again.",
    )

    sms_sent = True
    try:
        await send_sms(
            user.phone_number,
            (
                f"MonieKing: your password was reset by an administrator. "
                f"Temporary password: {temp_password}. Please log in and change it immediately."
            ),
        )
    except Exception as e:
        sms_sent = False
        print(f"[force-password-reset] SMS failed for {user.phone_number}: {e}")

    await log_action(
        db, actor_id=admin.id, action="user.password_force_reset",
        entity_type="user", entity_id=str(user.id),
        new_value={"sms_sent": sms_sent},
    )
    await db.commit()

    return {
        "message": "Password reset. SMS sent to the user." if sms_sent else "Password reset, but the SMS failed to send — share the temporary password with them another way.",
        # Only returned when the SMS genuinely couldn't be sent, so an
        # admin isn't stuck with no way to hand it over — never logged,
        # never returned when delivery succeeded.
        "temp_password": None if sms_sent else temp_password,
    }
