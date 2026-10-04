"""
Monnify payment webhook handler.
Idempotent: duplicate transaction references are silently ignored.
All wallet credits happen atomically inside a single DB transaction.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, status
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
    2. Deduplicate via transaction reference
    3. Match virtual account to wallet
    4. Credit wallet atomically
    5. Send in-app notification
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
                "Monnify sandbox webhook received with non-matching signature (%s). "
                "Allowing test payment in sandbox mode.", signature
            )
        else:
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload = await request.json()
    logger.info("Processing Monnify webhook payload: %s", payload)
    event   = provider.parse_webhook_event(payload)

    # Only process successful payments
    status_upper = (event.status or "").upper()
    if status_upper not in ("PAID", "COMPLETE", "COMPLETED", "SUCCESS", "SUCCESSFUL"):
        return {"message": f"Event acknowledged — status '{event.status}' not a payment completion"}

    # ── Step 2: Idempotency check ─────────────────────────────────
    existing = await db.execute(
        select(PaymentWebhook).where(
            PaymentWebhook.transaction_reference == event.transaction_reference
        )
    )
    if existing.scalar_one_or_none():
        return {"message": "Already processed"}

    # Insert webhook record (unprocessed)
    webhook_record = PaymentWebhook(
        provider=                "monnify",
        transaction_reference=   event.transaction_reference,
        amount_kobo=             event.amount_kobo,
        account_number=          event.account_number,
        raw_payload=             payload,
        processed=               False,
    )
    db.add(webhook_record)
    await db.flush()

    # ── Step 3: Find wallet by virtual account number ─────────────
    wallet_result = await db.execute(
        select(Wallet).where(Wallet.virtual_account_number == event.account_number)
    )
    wallet = wallet_result.scalar_one_or_none()

    if not wallet:
        webhook_record.processing_error = f"No wallet found for account {event.account_number}"
        await db.flush()
        return {"message": "Wallet not found — logged for manual review"}

    # ── Step 4: Credit wallet ─────────────────────────────────────
    try:
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
    except Exception as e:
        webhook_record.processing_error = str(e)
        await db.flush()
        raise HTTPException(status_code=500, detail="Failed to credit wallet")

    # ── Step 5: Mark processed + notify ──────────────────────────
    webhook_record.processed    = True
    webhook_record.processed_at = datetime.now(timezone.utc)

    await send_notification(
        db,
        user_id= wallet.owner_id,
        title=   "Wallet funded ✓",
        body=    f"Your wallet has been credited with ₦{event.amount_kobo // 100:,}. "
                 f"Ref: {event.transaction_reference}",
        type=    NotificationType.SUCCESS,
    )

    await db.flush()
    return {"message": "Payment processed successfully"}
