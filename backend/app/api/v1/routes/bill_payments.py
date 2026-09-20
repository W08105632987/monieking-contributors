import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CustomerOrOfficer
from app.models.bill_payment import Biller, BillPaymentRequest, BillerCategory
from app.models.identity_service import InitiatedBy
from app.schemas.bill_payment import (
    BillerItem, ValidateBillRequest, ValidateBillResponse,
    PayBillRequest, BillPaymentRequestItem,
)
from app.services import bill_payment_service

router = APIRouter(prefix="/bill-payments", tags=["bill-payments"])


@router.get("/categories")
async def get_categories():
    # Static — matches the fixed BillerCategory enum, not a live Monnify
    # call. Keeps the customer-facing card list instant on load.
    return [c.value for c in BillerCategory]


@router.get("/billers", response_model=list[BillerItem])
async def list_billers(category: str = Query(...), db: AsyncSession = Depends(get_db)):
    return await bill_payment_service.get_billers(db, category=category)


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
