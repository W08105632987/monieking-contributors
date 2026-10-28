import logging
import uuid
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CustomerOrOfficer, DirectorOnly
from app.models.bill_payment import Biller, BillPaymentRequest, BillPaymentStatus, BillerCategory
from app.models.identity_service import InitiatedBy
from app.schemas.bill_payment import (
    BillerItem, ValidateBillRequest, ValidateBillResponse,
    PayBillRequest, BillPaymentRequestItem, PricingPatch, BulkPricing,
)
from app.services import bill_payment_service, bill_config, bill_pricing, bill_admin
from app.integrations.monnify_bills import get_bills_provider, MonnifyBillsError
from pydantic import BaseModel, Field

router = APIRouter(prefix="/bill-payments", tags=["bill-payments"])
logger = logging.getLogger(__name__)

# Don't hit Monnify's requery endpoint for a request created seconds ago —
# the original vend call is usually still in flight.
REQUERY_AFTER_SECONDS = 5


@router.get("/categories")
async def get_categories():
    # Static — matches the fixed BillerCategory enum, not a live Monnify
    # call. Keeps the customer-facing card list instant on load.
    return [c.value for c in BillerCategory]


class BillsConfigPatch(BaseModel):
    airtime_enabled: bool | None = None
    data_enabled: bool | None = None
    bills_enabled: bool | None = None
    data_vtu_enabled: bool | None = None
    data_standard_enabled: bool | None = None
    networks: dict[str, bool] | None = None
    min_airtime_naira: int | None = Field(None, ge=10, le=1_000_000)
    max_airtime_naira: int | None = Field(None, ge=10, le=1_000_000)
    notice: str | None = Field(None, max_length=300)


class ValidatePhoneRequest(BaseModel):
    phone: str
    network: str | None = None


@router.get("/config")
async def public_config(db: AsyncSession = Depends(get_db)):
    """What the Airtime/Data/Bills screens may offer right now."""
    return await bill_config.get_bills_config(db)


@router.get("/admin/config")
async def admin_get_config(user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    return await bill_config.get_bills_config(db)


@router.put("/admin/config")
async def admin_put_config(body: BillsConfigPatch, user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    try:
        cfg = await bill_config.save_bills_config(db, body.model_dump(exclude_none=True), user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.commit()
    return cfg


@router.post("/validate-phone")
async def validate_phone(body: ValidatePhoneRequest, user: CustomerOrOfficer, db: AsyncSession = Depends(get_db)):
    """Real number check: format, network from prefix, a mismatch against the
    chosen network, and (best effort) Monnify's own MSISDN validation."""
    phone = bill_config.normalize_phone(body.phone)
    if not phone:
        return {"valid": False, "phone": None, "network": None, "verified": False,
                "message": "That is not a valid Nigerian mobile number."}
    detected = bill_config.detect_network(phone)
    chosen = body.network if body.network in bill_config.NETWORKS else None
    if chosen and detected and chosen != detected:
        return {"valid": False, "phone": phone, "network": detected, "verified": False,
                "message": f"This number looks like a {detected} line, not {chosen}."}
    net = chosen or detected
    verified = False
    message = None
    if net:
        billers = await bill_payment_service.get_billers(db, category="airtime")
        biller = next((b for b in billers if bill_config.network_of_biller_name(b.name) == net), None)
        if biller:
            try:
                await get_bills_provider().validate_customer(product_code=biller.product_id, customer_id=phone)
                verified = True
            except MonnifyBillsError as e:
                if not e.retriable:
                    return {"valid": False, "phone": phone, "network": net, "verified": False, "message": e.message}
    return {"valid": True, "phone": phone, "network": net, "verified": verified, "message": message}


@router.get("/billers", response_model=list[BillerItem])
async def list_billers(category: str = Query(...), db: AsyncSession = Depends(get_db)):
    rows = await bill_payment_service.get_billers(db, category=category)
    # price_kobo here is OUR price (what the customer pays), not Monnify's.
    return [
        BillerItem(
            id=b.id, category=b.category.value, name=b.name, product_id=b.product_id, product_name=b.product_name,
            price_kobo=bill_pricing.customer_unit_price_kobo(b), requires_validation=b.requires_validation,
            markup_percent=float(b.markup_percent or 0), min_amount_kobo=b.min_amount_kobo, max_amount_kobo=b.max_amount_kobo,
        )
        for b in rows
    ]


# ── Director: prices, commission and profit ───────────────────────────────

@router.get("/admin/pricing")
async def admin_pricing(user: DirectorOnly, category: str | None = None, db: AsyncSession = Depends(get_db)):
    try:
        return await bill_admin.list_prices(db, category)
    except ValueError:
        raise HTTPException(status_code=400, detail="Unknown category.")


@router.post("/admin/pricing/bulk")
async def admin_pricing_bulk(body: BulkPricing, user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    try:
        changed = await bill_admin.bulk_update(
            db, category=body.category, name_contains=body.name_contains, clear_overrides=body.clear_overrides,
            fields=body.model_dump(include={"markup_percent", "commission_percent"}, exclude_none=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.commit()
    return {"updated": changed}


@router.put("/admin/pricing/{biller_id}")
async def admin_pricing_update(biller_id: uuid.UUID, body: PricingPatch, user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    fields = {k: getattr(body, k) for k in body.model_fields_set}
    try:
        row = await bill_admin.update_price(db, biller_id, fields)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.commit()
    return row


@router.get("/admin/profit")
async def admin_profit(
    user: DirectorOnly, period: str = Query("today", pattern="^(today|week|month|custom)$"),
    start: date | None = None, end: date | None = None, db: AsyncSession = Depends(get_db),
):
    today = datetime.now(bill_admin.LAGOS).date()
    try:
        frm, to, label = bill_admin.range_bounds(period, today, start, end)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    report = await bill_admin.profit_report(db, frm, to)
    report["label"] = label
    return report


@router.post("/validate", response_model=ValidateBillResponse)
async def validate(
    body: ValidateBillRequest,
    user: CustomerOrOfficer,
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await bill_payment_service.validate_bill(
            db, biller_id=body.biller_id, customer_reference=body.customer_reference,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.post("/pay", response_model=BillPaymentRequestItem, status_code=201)
async def pay(
    body: PayBillRequest,
    user: CustomerOrOfficer,
    customer_id: uuid.UUID | None = Query(None, description="Required when an officer is paying on a customer's behalf"),
    db: AsyncSession = Depends(get_db),
):
    is_officer = user.role == "officer"
    if is_officer and not customer_id:
        raise HTTPException(status_code=400, detail="customer_id is required when an officer submits on a customer's behalf")

    from app.services.pin_service import check_pin
    await check_pin(db, user, body.pin)   # the person tapping Pay confirms with their own PIN

    try:
        request = await bill_payment_service.pay_bill(
            db,
            customer_id=customer_id if is_officer else user.id,
            biller_id=body.biller_id,
            customer_reference=body.customer_reference,
            amount_kobo=body.amount_kobo,
            quantity=body.quantity,
            validation_reference=body.validation_reference,
            initiated_by=InitiatedBy.OFFICER if is_officer else InitiatedBy.CUSTOMER,
            officer_id=user.id if is_officer else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return await _to_item(db, request)


@router.get("/requests/{request_id}", response_model=BillPaymentRequestItem)
async def get_request(request_id: uuid.UUID, user: CustomerOrOfficer, db: AsyncSession = Depends(get_db)):
    request = await db.get(BillPaymentRequest, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    # BUG MK-IDOR-001 FIX: this endpoint had no ownership check at all —
    # any authenticated customer could fetch any other customer's
    # bill-payment request by id. Mirrors the exact check already used
    # correctly by the analogous endpoint, identity_services.py's
    # get_request: a customer may only see their own; an officer isn't
    # restricted to their own submissions here since officers already
    # legitimately act on behalf of any customer in their zone for this
    # feature (see pay(), which lets an officer submit for any
    # customer_id, not just their own zone's — narrowing this check
    # further than that would be inconsistent with how /pay itself
    # already works).
    if user.role == "customer" and request.customer_id != user.id:
        raise HTTPException(status_code=403, detail="Not your request")

    # A request still PENDING (provider was slow / said "in progress") is
    # settled here as the app polls it: Monnify is asked for the real status
    # and the request is completed, or refunded if it truly failed.
    if request.status == BillPaymentStatus.PENDING:
        age = (datetime.now(timezone.utc) - request.created_at).total_seconds()
        if age >= REQUERY_AFTER_SECONDS:
            try:
                resolved = await bill_payment_service.resolve_pending_bill(db, request.id)
                if resolved is not None:
                    request = resolved
            except Exception:
                logger.exception("Could not resolve pending bill payment %s", request.id)
                await db.rollback()
                request = await db.get(BillPaymentRequest, request_id) or request
    return await _to_item(db, request)


async def _to_item(db: AsyncSession, request: BillPaymentRequest) -> BillPaymentRequestItem:
    biller = await db.get(Biller, request.biller_id)
    return BillPaymentRequestItem(
        id=request.id, biller_id=request.biller_id,
        biller_name=biller.name if biller else "Unknown biller",
        biller_category=biller.category.value if biller else "unknown",
        customer_id=request.customer_id, initiated_by=request.initiated_by.value,
        officer_id=request.officer_id, customer_reference=request.customer_reference,
        amount_kobo=request.amount_kobo, validated_account_name=request.validated_account_name,
        status=request.status.value, failure_reason=request.failure_reason,
        token=request.token, amount_charged_kobo=request.amount_charged_kobo,
        monnify_transaction_reference=request.monnify_transaction_reference,
        created_at=request.created_at, completed_at=request.completed_at,
    )
