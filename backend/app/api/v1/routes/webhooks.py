"""
Monnify payment webhook handler.
Idempotent: duplicate transaction references are silently ignored.
All wallet credits happen atomically inside a single DB transaction.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone

from app.core.database import get_db
from app.models.wallet import Wallet, TxCategory
from app.models.webhook import PaymentWebhook
from app.models.notification import NotificationType
from app.integrations.monnify import get_payment_provider
from app.services.wallet_service import credit_wallet
from app.services.notification_service import send_notification

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)

# The only Monnify event that means "money arrived in a customer's account".
# Monnify also posts disbursement, refund, settlement and mandate events —
# those carry a "SUCCESS"-style status too and must never credit a wallet.
PAYMENT_EVENT_TYPE = "SUCCESSFUL_TRANSACTION"
PAID_STATUSES = ("PAID", "COMPLETE", "COMPLETED", "SUCCESS", "SUCCESSFUL")


@router.post("/monnify/payment", status_code=status.HTTP_200_OK)
@router.post("/monnify/payment/", status_code=status.HTTP_200_OK)
async def monnify_payment_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Monnify calls this when a customer funds their virtual account.
    Steps:
    1. Verify HMAC signature
    2. Ignore anything that isn't a completed payment
    3. Deduplicate via transaction reference
    4. Match virtual account to wallet
    5. Credit wallet atomically
    6. Send in-app notification
    """
    raw_body = await request.body()
    signature = request.headers.get("monnify-signature", "")

    provider = get_payment_provider()

    # ── Step 1: Verify signature ──────────────────────────────────
    if not signature:
        if provider.is_sandbox:
            logger.warning(
                "Monnify sandbox webhook received with no signature header "
                "(expected in sandbox). Proceeding without verification."
            )
        else:
            raise HTTPException(status_code=401, detail="Invalid webhook signature")
    elif not provider.verify_webhook_signature(raw_body, signature):
        if provider.is_sandbox:
            logger.warning(
                "Monnify sandbox webhook received with non-matching signature. "
                "Allowing test payment in sandbox mode."
            )
        else:
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Webhook body is not valid JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Unexpected webhook body")

    # ── Step 2: Only completed payments ───────────────────────────
    event_type = str(payload.get("eventType") or "").strip().upper()
    if event_type and event_type != PAYMENT_EVENT_TYPE:
        return {"message": f"Event acknowledged — '{event_type}' is not a payment completion"}

    event = provider.parse_webhook_event(payload)

    # Log what's needed to trace a payment — never the whole payload, which
    # carries customer names, emails and account details.
    logger.info(
        "Monnify webhook: event=%s ref=%s status=%s amount_kobo=%s",
        event_type or "n/a", event.transaction_reference, event.status, event.amount_kobo,
    )

    status_upper = (event.status or "").upper()
    if status_upper not in PAID_STATUSES:
        return {"message": f"Event acknowledged — status '{event.status}' not a payment completion"}

    # A payment we can't identify, place, or size can't be credited, and an
    # empty reference would also poison the idempotency check (every later
    # empty-reference event would look "already processed").
    if not event.transaction_reference or not event.account_number or event.amount_kobo <= 0:
        logger.error(
            "Monnify payment webhook missing a usable reference/account/amount "
            "(ref=%r, account_present=%s, amount_kobo=%s) — not credited.",
            event.transaction_reference, bool(event.account_number), event.amount_kobo,
        )
        return {"message": "Event acknowledged — incomplete payment data, logged for manual review"}

    # ── Step 3: Idempotency check ─────────────────────────────────
    existing = await db.execute(
        select(PaymentWebhook).where(
            PaymentWebhook.transaction_reference == event.transaction_reference
        )
    )
    if existing.scalar_one_or_none():
        return {"message": "Already processed"}

    # Insert webhook record (unprocessed). The select above is only a fast
    # path — two deliveries of the same event can pass it at the same
    # moment, so the unique constraint is the real guard.
    webhook_record = PaymentWebhook(
        provider=                "monnify",
        transaction_reference=   event.transaction_reference,
        amount_kobo=             event.amount_kobo,
        account_number=          event.account_number[:20],
        raw_payload=             payload,
        processed=               False,
    )
    try:
        async with db.begin_nested():
            db.add(webhook_record)
            await db.flush()
    except IntegrityError:
        return {"message": "Already processed"}

    # ── Step 4: Find wallet by virtual account number ─────────────
    wallet_result = await db.execute(
        select(Wallet).where(Wallet.virtual_account_number == event.account_number)
    )
    wallet = wallet_result.scalar_one_or_none()

    if not wallet:
        webhook_record.processing_error = f"No wallet found for account {event.account_number}"
        await db.flush()
        logger.error("Monnify payment %s for unknown account — logged for manual review", event.transaction_reference)
        return {"message": "Wallet not found — logged for manual review"}

    # ── Step 5: Credit wallet ─────────────────────────────────────
    try:
        async with db.begin_nested():
            await credit_wallet(
                db,
                wallet=       wallet,
                amount_kobo=  event.amount_kobo,
                category=     TxCategory.WALLET_FUNDING,
                reference=    event.transaction_reference,
                description=  f"Monnify deposit — {event.transaction_reference}",
                initiated_by= wallet.owner_id,
                related_entity_type="wallet_funding",
            )
    except HTTPException as e:
        # A business-rule refusal (e.g. frozen wallet). Retrying can't fix it
        # and returning an error would make Monnify retry forever while the
        # failure itself was rolled back and lost — keep the record, surface
        # it for manual review, and acknowledge.
        webhook_record.processing_error = f"Not credited: {e.detail}"
        await db.flush()
        logger.error("Monnify payment %s received but not credited: %s", event.transaction_reference, e.detail)
        return {"message": "Payment received but not credited — logged for manual review"}
    except Exception as e:
        # Unexpected/transient: error out so Monnify retries the delivery.
        logger.exception("Failed to credit wallet for Monnify payment %s", event.transaction_reference)
        raise HTTPException(status_code=500, detail="Failed to credit wallet")

    # ── Step 6: Mark processed + notify ──────────────────────────
    webhook_record.processed    = True
    webhook_record.processed_at = datetime.now(timezone.utc)

    await send_notification(
        db,
        user_id= wallet.owner_id,
        title=   "Wallet funded ✓",
        body=    f"Your wallet has been credited with ₦{event.amount_kobo / 100:,.2f}. "
                 f"Ref: {event.transaction_reference}",
        type=    NotificationType.SUCCESS,
        deep_link_url="/customer/wallet/transactions",
    )

    await db.flush()
    return {"message": "Payment processed successfully"}
