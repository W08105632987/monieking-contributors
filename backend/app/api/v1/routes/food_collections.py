import secrets
import string
import uuid
from datetime import datetime, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import CurrentUser, CustomerOnly, OfficerOnly, DirectorOrAdmin
from app.models.card import ContributionCard, CardType, CardStatus
from app.models.food_entitlement import (
    FoodEntitlement, FoodCollectionPoint, FoodCollectionAudit, EntitlementStatus,
)
from app.models.user import User

router = APIRouter(prefix="/food-collections", tags=["Food Collections"])


def _mask_name(full_name: str) -> str:
    parts = full_name.strip().split()
    if not parts:
        return "Unknown"
    if len(parts) == 1:
        return f"{parts[0][0]}***"
    return f"{parts[0]} {parts[-1][0]}."


def _mask_card_number(num: int) -> str:
    s = str(num)
    if len(s) <= 2:
        return f"MK••{s}"
    return f"MK••{s[-2:]}"


# ── Schemas ───────────────────────────────────────────────────────
class VerifyQrRequest(BaseModel):
    qr_token: str


class MaskedBeneficiaryResponse(BaseModel):
    entitlement_id: str
    masked_name: str
    masked_card: str
    package_name: str
    status: str
    year: int
    is_eligible_for_collection: bool
    message: str


class ConfirmCollectionRequest(BaseModel):
    entitlement_id: str
    collection_pin: str
    collection_point_id: str | None = None
    notes: str | None = None


class RevokeEntitlementRequest(BaseModel):
    entitlement_id: str
    reason: str


class CustomerEntitlementResponse(BaseModel):
    has_entitlement: bool
    qr_token: str | None = None
    collection_pin: str | None = None
    package_name: str | None = None
    status: str | None = None
    card_number: int | None = None
    collected_at: datetime | None = None
    distribution_date: str = "December 10"


# ── Customer: View my QR & PIN ───────────────────────────────────
@router.get("/me", response_model=CustomerEntitlementResponse)
async def get_my_food_entitlement(
    current_user: CustomerOnly,
    db: AsyncSession = Depends(get_db),
):
    current_year = datetime.now(timezone.utc).year

    # Check if user already has an active entitlement for this year
    stmt = (
        select(FoodEntitlement)
        .options(selectinload(FoodEntitlement.card))
        .where(
            and_(
                FoodEntitlement.customer_id == current_user.id,
                FoodEntitlement.year == current_year,
            )
        )
    )
    res = await db.execute(stmt)
    entitlement = res.scalar_one_or_none()

    if entitlement:
        return CustomerEntitlementResponse(
            has_entitlement=True,
            qr_token=entitlement.qr_token,
            collection_pin=entitlement.collection_pin,
            package_name=entitlement.package_name,
            status=entitlement.status.value,
            card_number=entitlement.card.card_number if entitlement.card else None,
            collected_at=entitlement.collected_at,
        )

    # Check if customer has a completed Food Card for this year (all 372 days completed)
    card_stmt = select(ContributionCard).where(
        and_(
            ContributionCard.owner_id == current_user.id,
            ContributionCard.card_type == CardType.FOOD,
            ContributionCard.total_days_contributed >= 372,
        )
    )
    c_res = await db.execute(card_stmt)
    completed_card = c_res.scalars().first()

    if not completed_card:
        return CustomerEntitlementResponse(has_entitlement=False)

    # Generate secure token & 4-digit PIN
    token_str = "MKF_" + secrets.token_urlsafe(16)
    pin_str = "".join(secrets.choice(string.digits) for _ in range(4))

    entitlement = FoodEntitlement(
        card_id=completed_card.id,
        customer_id=current_user.id,
        qr_token=token_str,
        collection_pin=pin_str,
        package_name="Standard Holiday Food Package",
        year=current_year,
        status=EntitlementStatus.ACTIVE,
    )
    db.add(entitlement)
    await db.flush()

    return CustomerEntitlementResponse(
        has_entitlement=True,
        qr_token=entitlement.qr_token,
        collection_pin=entitlement.collection_pin,
        package_name=entitlement.package_name,
        status=entitlement.status.value,
        card_number=completed_card.card_number,
    )


# ── Officer: Step 1 - Scan & Verify QR Token ──────────────────────
@router.post("/verify-qr", response_model=MaskedBeneficiaryResponse)
async def verify_food_qr(
    payload: VerifyQrRequest,
    current_officer: CurrentUser, # Officer or Director
    db: AsyncSession = Depends(get_db),
):
    if current_officer.role not in ["officer", "director", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only authorized distribution officers or directors can scan food QR codes.",
        )

    stmt = (
        select(FoodEntitlement)
        .options(selectinload(FoodEntitlement.customer), selectinload(FoodEntitlement.card))
        .where(FoodEntitlement.qr_token == payload.qr_token.strip())
    )
    res = await db.execute(stmt)
    entitlement = res.scalar_one_or_none()

    if not entitlement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid QR code. No food entitlement found.",
        )

    masked_name = _mask_name(entitlement.customer.full_name) if entitlement.customer else "Beneficiary"
    masked_card = _mask_card_number(entitlement.card.card_number) if entitlement.card else "MK••••"

    is_eligible = (entitlement.status == EntitlementStatus.ACTIVE)
    if entitlement.status == EntitlementStatus.USED:
        msg = f"Already collected on {entitlement.collected_at.strftime('%b %d, %Y %I:%M %p') if entitlement.collected_at else 'distribution day'}."
    elif entitlement.status == EntitlementStatus.REVOKED:
        msg = "This entitlement has been revoked by management."
    elif entitlement.status == EntitlementStatus.EXPIRED:
        msg = "This entitlement has expired."
    else:
        msg = "Verified eligible. Please enter customer's 4-digit Collection PIN to dispense."

    return MaskedBeneficiaryResponse(
        entitlement_id=str(entitlement.id),
        masked_name=masked_name,
        masked_card=masked_card,
        package_name=entitlement.package_name,
        status=entitlement.status.value,
        year=entitlement.year,
        is_eligible_for_collection=is_eligible,
        message=msg,
    )


# ── Officer: Step 2 - Authenticate PIN & Confirm Dispensation ─────
@router.post("/confirm")
async def confirm_food_collection(
    payload: ConfirmCollectionRequest,
    current_officer: CurrentUser,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    if current_officer.role not in ["officer", "director", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only authorized staff can confirm food distribution.",
        )

    try:
        ent_id = uuid.UUID(payload.entitlement_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid entitlement ID")

    # Atomic Row-level lock to prevent double-spending & race conditions
    stmt = (
        select(FoodEntitlement)
        .where(FoodEntitlement.id == ent_id)
        .with_for_update()
    )
    res = await db.execute(stmt)
    entitlement = res.scalar_one_or_none()

    if not entitlement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entitlement not found")

    if entitlement.status != EntitlementStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot dispense. Entitlement status is {entitlement.status.value.upper()}.",
        )

    # Validate 4-digit Collection PIN
    if payload.collection_pin.strip() != entitlement.collection_pin.strip():
        entitlement.failed_attempts += 1
        audit = FoodCollectionAudit(
            audit_code=f"FC-FAIL-{secrets.token_hex(4).upper()}",
            entitlement_id=entitlement.id,
            officer_id=current_officer.id,
            action="PIN_FAILED",
            ip_address=request.client.host if request.client else None,
            notes=f"Wrong PIN entered: attempt {entitlement.failed_attempts}",
        )
        db.add(audit)
        await db.commit()

        if entitlement.failed_attempts >= 3:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect PIN. Max failed attempts reached. Please verify with customer.",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect 4-digit Collection PIN. Please ask customer to verify in their app.",
        )

    # PIN validated successfully! Atomically mark used
    now = datetime.now(timezone.utc)
    entitlement.status = EntitlementStatus.USED
    entitlement.collected_at = now
    entitlement.collected_by = current_officer.id

    if payload.collection_point_id:
        try:
            entitlement.collection_point_id = uuid.UUID(payload.collection_point_id)
        except ValueError:
            pass

    audit_code = f"FC-{now.year}-{secrets.token_hex(4).upper()}"
    audit = FoodCollectionAudit(
        audit_code=audit_code,
        entitlement_id=entitlement.id,
        officer_id=current_officer.id,
        action="CONFIRMED",
        ip_address=request.client.host if request.client else None,
        notes=payload.notes,
    )
    db.add(audit)
    await db.commit()

    return {
        "success": True,
        "audit_code": audit_code,
        "package_name": entitlement.package_name,
        "collected_at": now.isoformat(),
        "message": "Food package dispensation confirmed successfully.",
    }


# ── Director: Emergency Revocation ────────────────────────────────
@router.post("/revoke")
async def revoke_food_entitlement(
    payload: RevokeEntitlementRequest,
    director: DirectorOrAdmin,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        ent_id = uuid.UUID(payload.entitlement_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid entitlement ID")

    stmt = select(FoodEntitlement).where(FoodEntitlement.id == ent_id).with_for_update()
    res = await db.execute(stmt)
    entitlement = res.scalar_one_or_none()

    if not entitlement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entitlement not found")

    entitlement.status = EntitlementStatus.REVOKED
    audit = FoodCollectionAudit(
        audit_code=f"FC-REV-{secrets.token_hex(4).upper()}",
        entitlement_id=entitlement.id,
        officer_id=director.id,
        action="REVOKED",
        ip_address=request.client.host if request.client else None,
        notes=payload.reason,
    )
    db.add(audit)
    await db.commit()

    return {"success": True, "message": "Entitlement revoked."}
