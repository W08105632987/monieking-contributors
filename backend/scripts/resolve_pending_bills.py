"""
Settles bill payments that are still PENDING — i.e. the vend call timed out,
Monnify said "in progress", or the server stopped mid-payment. For each one it
asks Monnify for the real status and then:

  confirmed paid    -> marks the request COMPLETED
  confirmed failed  -> refunds the customer's wallet, marks it FAILED
  still in progress -> leaves it alone (the money stays held)

Run with:  python -m scripts.resolve_pending_bills

Safe to run as often as you like — every minute or two on a scheduler is
fine. A refund can only ever happen once per request.

Anything still PENDING after 30 minutes is listed at the end for manual
review (usually: Monnify never received the vend, or the requery endpoint
can't find it).
"""
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.bill_payment import BillPaymentRequest, BillPaymentStatus
from app.services.bill_payment_service import resolve_pending_bill

# Leave brand-new requests alone: their original vend call is probably still
# in flight in the web process.
MIN_AGE = timedelta(seconds=60)
REVIEW_AFTER = timedelta(minutes=30)


async def run():
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        ids = (await db.execute(
            select(BillPaymentRequest.id)
            .where(BillPaymentRequest.status == BillPaymentStatus.PENDING,
                   BillPaymentRequest.created_at < now - MIN_AGE)
            .order_by(BillPaymentRequest.created_at)
        )).scalars().all()

    print(f"{len(ids)} pending bill payment(s) to check.")
    still_pending = []
    for request_id in ids:
        async with AsyncSessionLocal() as db:
            request = await resolve_pending_bill(db, request_id)
            if request is None:
                continue
            print(f"  {request_id}: {request.status.value}")
            if request.status == BillPaymentStatus.PENDING and now - request.created_at > REVIEW_AFTER:
                still_pending.append(request)

    if still_pending:
        print(f"\n{len(still_pending)} request(s) still pending after 30 minutes — review manually:")
        for r in still_pending:
            print(f"  {r.id}  ₦{r.amount_kobo / 100:,.2f}  customer={r.customer_id}  created={r.created_at}")


if __name__ == "__main__":
    asyncio.run(run())
