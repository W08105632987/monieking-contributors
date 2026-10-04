import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bill_payment import Biller, BillPaymentRequest, BillPaymentStatus, BillerCategory
from app.models.identity_service import InitiatedBy
from app.models.wallet import TxCategory
from app.services.wallet_service import get_or_create_wallet, debit_wallet
from app.integrations.monnify_bills import get_bills_provider, MonnifyBillsError
from app.core.security import generate_reference
from app.utils.audit import log_action


def _mask(value: str) -> str:
    """Same masking convention as identity_services._mask — kept as its own
    copy rather than a shared import because the two modules' sensitive-field
    lists diverge (bills has no NIN/BVN, identity_services has no meter
    numbers) and coupling them would make either one harder to change safely."""
    v = str(value)
    if len(v) <= 4:
        return "•" * len(v)
    return v[:2] + "•" * (len(v) - 4) + v[-2:]


async def get_billers(db: AsyncSession, category: str) -> list[Biller]:
    result = await db.execute(
        select(Biller).where(Biller.category == category, Biller.is_active == True)  # noqa: E712
        .order_by(Biller.name)
    )
    return list(result.scalars().all())


# Our internal (lowercase) category values -> Monnify's own categoryCode
# strings, confirmed from developers.monnify.com/docs/bills-payment/
# process-a-bill's own examples ("ELECTRICITY, DATA, CABLE_TV"). AIRTIME
# and EDUCATION follow the same naming pattern but weren't shown
# explicitly in that example — verify these two specifically against
# your account's actual GET /billers/categories response before
# depending on them, since an unconfirmed guess here just returns an
# empty biller list for that category rather than an obvious error.
CATEGORY_CODE_MAP = {
    BillerCategory.AIRTIME: "AIRTIME",
    BillerCategory.DATA: "DATA",
    BillerCategory.ELECTRICITY: "ELECTRICITY",
    BillerCategory.CABLE_TV: "CABLE_TV",
    BillerCategory.EDUCATION: "EDUCATION",
}


async def sync_billers(db: AsyncSession) -> dict:
    """
    Populates/refreshes the billers table from Monnify's live Discovery
    API — the piece referenced in migration 019's own comment
    ("Refreshed on a schedule (see bill_payment_service.sync_billers)")
    that was never actually implemented. Without this having run at
    least once, GET /bill-payments/billers always returns an empty
    list for every category, even once the schema itself is correct —
    there's simply nothing in the table yet.

    Three-step discovery per Monnify's documented flow — the middle and
    last steps are real HTTP calls per biller, so this is deliberately
    NOT something to run on every page load (same reasoning as the
    docstring on the Biller model itself); run it via
    scripts/sync_billers.py on a schedule (daily is plenty — biller
    catalogs and prices don't change intraday) or manually after a
    provider-side catalog update.

    Upserts on (monnify_biller_id, product_id) — matches the table's own
    UNIQUE constraint — so re-running this is always safe: existing
    rows get their name/price/is_active refreshed in place, nothing is
    duplicated.
    """
    provider = get_bills_provider()
    synced = 0
    errors: list[str] = []

    for internal_category, monnify_category_code in CATEGORY_CODE_MAP.items():
        try:
            billers = await provider.get_billers(monnify_category_code)
        except MonnifyBillsError as e:
            errors.append(f"{internal_category.value}: couldn't list billers ({e.message})")
            continue

        for biller_row in billers:
            # Field names here (billerCode, name/billerName) are the
            # other half of what this whole audit is about — confirm
            # against your actual sandbox response and adjust if
            # Monnify's real payload uses different keys than assumed.
            biller_code = biller_row.get("billerCode") or biller_row.get("code")
            biller_name = biller_row.get("name") or biller_row.get("billerName") or biller_code
            if not biller_code:
                errors.append(f"{internal_category.value}: a biller row had no billerCode, skipped: {biller_row}")
                continue

            try:
                products = await provider.get_biller_products(biller_code)
            except MonnifyBillsError as e:
                errors.append(f"{biller_name}: couldn't list products ({e.message})")
                continue

            for product_row in products:
                product_code = product_row.get("productCode") or product_row.get("code")
                product_name = product_row.get("name") or product_row.get("productName") or product_code
                if not product_code:
                    errors.append(f"{biller_name}: a product row had no productCode, skipped: {product_row}")
                    continue

                # Fixed price if the product declares one; None (customer
                # types an amount) for variable-amount products like
                # airtime and most electricity products. Monnify's field
                # for this varies by category in the docs' own examples —
                # check for either an "amount" or "price" key.
                raw_price = product_row.get("amount") or product_row.get("price")
                price_kobo = int(float(raw_price) * 100) if raw_price not in (None, "", 0, "0") else None
                requires_validation = bool(product_row.get("requireValidationRef") or product_row.get("requiresValidation"))

                existing = (await db.execute(
                    select(Biller).where(Biller.monnify_biller_id == biller_code, Biller.product_id == product_code)
                )).scalar_one_or_none()

                if existing:
                    existing.name = biller_name
                    existing.product_name = product_name
                    existing.price_kobo = price_kobo
                    existing.requires_validation = requires_validation
                    existing.is_active = True
                    existing.last_synced_at = datetime.now(timezone.utc)
                else:
                    db.add(Biller(
                        monnify_biller_id=biller_code,
                        category=internal_category,
                        name=biller_name,
                        product_id=product_code,
                        product_name=product_name,
                        price_kobo=price_kobo,
                        requires_validation=requires_validation,
                        is_active=True,
                    ))
                synced += 1

    await db.commit()
    return {"synced": synced, "errors": errors}


async def validate_bill(
    db: AsyncSession, *, biller_id: uuid.UUID, customer_reference: str,
) -> dict:
    biller = await db.get(Biller, biller_id)
    if not biller or not biller.is_active:
        raise ValueError("Biller not found or unavailable")

    if not biller.requires_validation:
        # Airtime/data — nothing to confirm, the phone number IS the target.
        return {"validation_reference": None, "validated_account_name": None, "requires_validation": False}

    provider = get_bills_provider()
    try:
        result = await provider.validate_customer(
            product_code=biller.product_id,
            customer_id=customer_reference,
        )
    except MonnifyBillsError as e:
        raise ValueError(e.message)

    return {
        "validation_reference": result.get("validationReference"),
        "validated_account_name": result.get("customerName") or result.get("customerFullName"),
        "requires_validation": True,
    }


async def pay_bill(
    db: AsyncSession, *,
    customer_id: uuid.UUID,
    biller_id: uuid.UUID,
    customer_reference: str,
    amount_kobo: int | None,
    quantity: int = 1,
    validation_reference: str | None,
    initiated_by: InitiatedBy,
    officer_id: uuid.UUID | None = None,
) -> BillPaymentRequest:
    biller = await db.get(Biller, biller_id)
    if not biller or not biller.is_active:
        raise ValueError("Biller not found or unavailable")

    if biller.requires_validation and not validation_reference:
        raise ValueError("This biller requires validation before payment — call /bill-payments/validate first.")

    # Resolve the ACTUAL amount to charge. For fixed-price products
    # (data plans, education PINs) the biller's own price is authoritative
    # — we never trust whatever the client sent, since that would let a
    # tampered request buy a ₦5,000 data plan for ₦100. For
    # variable-amount billers (airtime, electricity) the customer's typed
    # amount is the only source of truth, so it's required here.
    if biller.price_kobo is not None:
        resolved_amount_kobo = biller.price_kobo * quantity
    else:
        if not amount_kobo or amount_kobo <= 0:
            raise ValueError("An amount is required for this bill.")
        resolved_amount_kobo = amount_kobo

    # Balance check BEFORE calling the provider — never spend money on a
    # provider call you can't collect for. Same rule as identity_services.
    wallet = await get_or_create_wallet(db, customer_id)
    if wallet.balance_kobo < resolved_amount_kobo:
        raise ValueError("Insufficient wallet balance.")

    request = BillPaymentRequest(
        customer_id=customer_id,
        initiated_by=initiated_by,
        officer_id=officer_id,
        biller_id=biller_id,
        customer_reference=_mask(customer_reference),
        amount_kobo=resolved_amount_kobo,
        validation_reference=validation_reference,
        status=BillPaymentStatus.PENDING,
    )
    db.add(request)
    await db.flush()

    provider = get_bills_provider()
    try:
        # vend_reference = this request's own id — stable across any
        # retry (the request row already exists by this point, flushed
        # above, so its id never changes), which is exactly what a
        # required-and-previously-missing vendReference is for: letting
        # Monnify recognize a retried call as the same request instead
        # of vending twice. See vend_bill's docstring in monnify_bills.py.
        result = await provider.vend_bill(
            product_code=biller.product_id,
            customer_id=customer_reference,
            amount_kobo=resolved_amount_kobo,
            vend_reference=str(request.id),
            validation_reference=validation_reference,
        )
    except MonnifyBillsError as e:
        request.status = BillPaymentStatus.FAILED
        request.failure_reason = e.message
        await db.flush()
        await db.commit()
        # Nothing charged — the wallet debit only happens after a confirmed
        # success below, never speculatively.
        return request

    # Confirmed success — charge the wallet now, not before.
    reference = generate_reference()
    await debit_wallet(
        db, wallet=wallet, amount_kobo=resolved_amount_kobo, category=TxCategory.CHARGE,
        reference=reference, description=f"{biller.name} — {biller.product_name}",
        initiated_by=officer_id or customer_id,
        related_entity_type="bill_payment", related_entity_id=request.id,
    )

    request.status = BillPaymentStatus.COMPLETED
    request.monnify_transaction_reference = result.get("transactionReference")
    request.token = result.get("token")   # present for electricity, null otherwise
    request.amount_charged_kobo = resolved_amount_kobo
    request.completed_at = datetime.now(timezone.utc)
    await db.flush()

    await log_action(
        db, actor_id=officer_id or customer_id, action="bill_payment.completed",
        entity_type="bill_payment_request", entity_id=str(request.id),
        new_value={"biller": biller.name, "amount_kobo": resolved_amount_kobo},
    )
    await db.commit()
    await db.refresh(request)
    return request
