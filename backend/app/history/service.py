"""One chronological feed: identity (Youverify) requests, manual-service jobs,
bill payments and Techhub NIN/BVN verifications — failed and uncharged ones
included, because "what happened to my request?" is exactly what people open
History to find out. Read-only; changes no money or status."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bill_payment import Biller, BillPaymentRequest
from app.models.identity_service import IdentityService, IdentityServiceRequest
from app.models.manual_service_request import ManualServiceRequest
from app.history.feed import (_BILL_UNPAID, _manual_title, _v, bill_item, identity_item, manual_item,
                              merge, verification_item)
from app.verification.models import VerificationLookup



async def build_feed(db: AsyncSession, *, actor_id: uuid.UUID, is_officer: bool, customer_id: uuid.UUID, limit: int) -> list[dict]:
    items: list[dict] = []

    rows = (await db.execute(
        select(IdentityServiceRequest, IdentityService.name, IdentityService.category)
        .join(IdentityService, IdentityService.id == IdentityServiceRequest.service_id)
        .where(IdentityServiceRequest.customer_id == customer_id)
        .order_by(IdentityServiceRequest.created_at.desc()).limit(limit))).all()
    items += [identity_item(r, n, c) for r, n, c in rows]

    manual = (await db.execute(
        select(ManualServiceRequest).where(ManualServiceRequest.user_id == customer_id)
        .order_by(ManualServiceRequest.created_at.desc()).limit(limit))).scalars().all()
    items += [manual_item(r, _manual_title(r)) for r in manual]

    bills = (await db.execute(
        select(BillPaymentRequest, Biller.name, Biller.product_name)
        .join(Biller, Biller.id == BillPaymentRequest.biller_id)
        .where(BillPaymentRequest.customer_id == customer_id)
        .order_by(BillPaymentRequest.created_at.desc()).limit(limit))).all()
    items += [bill_item(r, f"{n} · {p}") for r, n, p in bills if _v(r.status) not in _BILL_UNPAID]

    q = select(VerificationLookup).where(VerificationLookup.customer_id == customer_id,
                                         VerificationLookup.status != "pending")
    if is_officer:   # an officer sees only the checks they ran themselves
        q = q.where(VerificationLookup.officer_id == actor_id)
    ver = (await db.execute(q.order_by(VerificationLookup.created_at.desc()).limit(limit))).scalars().all()
    items += [verification_item(r) for r in ver]
    return merge(items, limit)


