import logging
import re
import uuid
import asyncio
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bill_payment import Biller, BillPaymentRequest, BillPaymentStatus, BillerCategory
from app.models.identity_service import InitiatedBy
from app.models.wallet import TxCategory, WalletTransaction
from app.services.wallet_service import get_or_create_wallet, debit_wallet, credit_wallet
from app.integrations.monnify_bills import get_bills_provider, MonnifyBillsError, vend_outcome
from app.utils.audit import log_action
from app.services import bill_config

logger = logging.getLogger(__name__)

PENDING_NOTE = "Waiting for the bills provider to confirm this payment."


def _mask(value: str) -> str:
    """Same masking convention as identity_services._mask — kept as its own
    copy rather than a shared import because the two modules' sensitive-field
    lists diverge (bills has no NIN/BVN, identity_services has no meter
    numbers) and coupling them would make either one harder to change safely."""
    v = str(value)
    if len(v) <= 4:
        return "•" * len(v)
    return v[:2] + "•" * (len(v) - 4) + v[-2:]


def _debit_reference(request: BillPaymentRequest) -> str:
    """Deterministic, so the debit for a request can always be found again
    (wallet_transactions.reference is unique)."""
    return f"BILL-{request.id.hex}"


def _reversal_reference(request: BillPaymentRequest) -> str:
    """Deterministic AND unique per request: a second refund attempt for the
    same request collides on the unique reference instead of paying twice."""
    return f"BILLREV-{request.id.hex}"


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
# your account's actual biller-categories response before depending on
# them, since an unconfirmed guess here just returns an empty biller list
# for that category rather than an obvious error.
CATEGORY_CODE_MAP = {
    BillerCategory.AIRTIME: "AIRTIME",
    BillerCategory.DATA: "DATA",
    BillerCategory.ELECTRICITY: "ELECTRICITY",
    BillerCategory.CABLE_TV: "CABLE_TV",
    BillerCategory.EDUCATION: "EDUCATION",
}

# Monnify's validation step is mandatory for these before a vend. Whether a
# validationReference is then needed comes from the validate-customer
# response itself (vendInstruction.requireValidationRef) — NOT from the
# product list, which doesn't carry it.
VALIDATION_REQUIRED_CATEGORIES = {
    BillerCategory.ELECTRICITY, BillerCategory.CABLE_TV, BillerCategory.EDUCATION,
}


def _price_to_kobo(raw) -> int | None:
    """Naira (str/number) -> kobo. Rounds (int(float(x) * 100) truncates:
    1234.56 * 100 == 123455.99999999999, i.e. a kobo short). A price of zero
    or less is treated as 'no fixed price' — a 0 here would otherwise make
    pay_bill charge nothing for the product."""
    if raw in (None, ""):
        return None
    try:
        kobo = int(round(float(raw) * 100))
    except (TypeError, ValueError):
        return None
    return kobo if kobo > 0 else None


async def sync_billers(db: AsyncSession) -> dict:
    """
    Populates/refreshes the billers table from Monnify's live Discovery
    API. Without this having run at least once, GET /bill-payments/billers
    always returns an empty list for every category.

    Three-step discovery per Monnify's documented flow — the middle and
    last steps are real HTTP calls per biller, so this is deliberately
    NOT something to run on every page load; run it via
    scripts/sync_billers.py on a schedule (daily is plenty) or manually
    after a provider-side catalog update.

    Upserts on (monnify_biller_id, product_id) — matches the table's own
    UNIQUE constraint — so re-running this is always safe.

    - A director's manual hide (is_active = False) is respected: existing
      rows are never re-activated by a sync.
    - A product that Monnify no longer lists is deactivated, but only when
      that whole category synced cleanly, so a transient error can't wipe
      the catalogue.
    - `samples` returns the first raw biller/product row per category so the
      real Monnify field names can be checked against what we read.
    """
    provider = get_bills_provider()
    synced = 0
    deactivated = 0
    errors: list[str] = []
    samples: dict[str, dict] = {}
    BATCH = 150          # rows per database transaction: small, so the connection is never held for long
    sem = asyncio.Semaphore(6)

    async def _products_for(biller_code: str, biller_name: str):
        async with sem:
            try:
                return await provider.get_biller_products(biller_code), None
            except MonnifyBillsError as e:
                return None, f"{biller_name}: couldn't list products ({e.message})"

    for internal_category, monnify_category_code in CATEGORY_CODE_MAP.items():
        category_clean = True

        # ── Phase 1: talk to Monnify ONLY (no database open while we wait on the network) ──
        try:
            billers = await provider.get_billers(monnify_category_code)
        except MonnifyBillsError as e:
            errors.append(f"{internal_category.value}: couldn't list billers ({e.message})")
            continue

        if billers:
            samples.setdefault(internal_category.value, {})["biller"] = billers[0]

        jobs = []
        for biller_row in billers:
            raw_biller_code = biller_row.get("billerCode") or biller_row.get("code")
            if not raw_biller_code:
                errors.append(f"{internal_category.value}: a biller row had no billerCode, skipped: {biller_row}")
                category_clean = False
                continue
            biller_code = str(raw_biller_code)[:80]
            biller_name = str(biller_row.get("name") or biller_row.get("billerName") or biller_code)[:160]
            jobs.append((biller_code, biller_name))
        results = await asyncio.gather(*[_products_for(c, n) for c, n in jobs])

        wanted: dict[tuple[str, str], dict] = {}
        for (biller_code, biller_name), (products, err) in zip(jobs, results):
            if err:
                errors.append(err)
                category_clean = False
                continue
            if products and "product" not in samples.get(internal_category.value, {}):
                samples.setdefault(internal_category.value, {})["product"] = products[0]
            for product_row in products or []:
                raw_product_code = product_row.get("productCode") or product_row.get("code")
                if not raw_product_code:
                    errors.append(f"{biller_name}: a product row had no productCode, skipped: {product_row}")
                    category_clean = False
                    continue
                product_code = str(raw_product_code)[:80]
                product_name = str(product_row.get("name") or product_row.get("productName") or product_code)[:160]
                key = (biller_code, product_code)
                if key in wanted:
                    continue   # same pair twice in one run would violate the unique constraint
                wanted[key] = {
                    "name": biller_name,
                    "product_name": product_name,
                    # Fixed price if the product declares one; None (customer types an amount) for variable-amount products.
                    "price_kobo": _price_to_kobo(product_row.get("amount") or product_row.get("price")),
                    "requires_validation": (
                        bool(product_row.get("requireValidationRef") or product_row.get("requiresValidation"))
                        or internal_category in VALIDATION_REQUIRED_CATEGORIES
                    ),
                }

        # ── Phase 2: write to the database in short batches ──
        existing_rows = (await db.execute(
            select(Biller).where(Biller.category == internal_category)
        )).scalars().all()
        # (the same biller/product could in theory sit under another category; look those up too)
        existing = {(r.monnify_biller_id, r.product_id): r for r in existing_rows}
        pending = 0
        for key, vals in wanted.items():
            row = existing.get(key)
            if row is None:
                other = (await db.execute(
                    select(Biller).where(Biller.monnify_biller_id == key[0], Biller.product_id == key[1])
                )).scalar_one_or_none()
                row = other
            if row:
                row.name = vals["name"]
                row.product_name = vals["product_name"]
                row.price_kobo = vals["price_kobo"]
                row.requires_validation = vals["requires_validation"]
                row.last_synced_at = datetime.now(timezone.utc)
                # is_active deliberately untouched — see docstring.
            else:
                db.add(Biller(
                    monnify_biller_id=key[0], category=internal_category, name=vals["name"],
                    product_id=key[1], product_name=vals["product_name"], price_kobo=vals["price_kobo"],
                    requires_validation=vals["requires_validation"], is_active=True,
                ))
            synced += 1
            pending += 1
            if pending >= BATCH:
                await db.commit()
                pending = 0

        if category_clean and wanted:
            for row in existing_rows:
                if row.is_active and (row.monnify_biller_id, row.product_id) not in wanted:
                    row.is_active = False
                    deactivated += 1
        await db.commit()

    return {"synced": synced, "deactivated": deactivated, "errors": errors, "samples": samples}


def _read_vend_instruction(result: dict) -> tuple[bool, str | None]:
    """(requires_validation_reference, validation_reference) from a
    validate-customer response."""
    if not isinstance(result, dict):
        return False, None
    instruction = result.get("vendInstruction")
    if not isinstance(instruction, dict):
        instruction = {}
    ref = result.get("validationReference") or instruction.get("validationReference")
    ref = str(ref)[:120] if ref else None
    if "requireValidationRef" in instruction:
        required = bool(instruction.get("requireValidationRef"))
    else:
        required = bool(ref)
    return required, ref


def _read_customer_name(result: dict) -> str | None:
    if not isinstance(result, dict):
        return None
    name = result.get("customerName") or result.get("customerFullName")
    return str(name)[:160] if name else None


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

    required, ref = _read_vend_instruction(result)
    if required and not ref:
        raise ValueError("The bills provider did not return a validation reference. Please try again.")

    return {
        "validation_reference": ref if required else None,
        "validated_account_name": _read_customer_name(result),
        "requires_validation": True,
    }


async def _enforce_director_rules(db: AsyncSession, biller: Biller, customer_reference: str, amount_kobo: int | None) -> None:
    """Server-side enforcement of the director's switches — the app hides
    things too, but only this check is authoritative."""
    cfg = await bill_config.get_bills_config(db)
    cat = biller.category
    if cat == BillerCategory.AIRTIME and not cfg["airtime_enabled"]:
        raise ValueError("Airtime purchases are temporarily unavailable.")
    if cat == BillerCategory.DATA:
        if not cfg["data_enabled"]:
            raise ValueError("Data purchases are temporarily unavailable.")
        vtu = bill_config.is_vtu_plan(biller.product_name, biller.name)
        if vtu and not cfg["data_vtu_enabled"]:
            raise ValueError("VTU data is temporarily unavailable.")
        if not vtu and not cfg["data_standard_enabled"]:
            raise ValueError("Standard data is temporarily unavailable.")
    if cat in (BillerCategory.ELECTRICITY, BillerCategory.CABLE_TV) and not cfg["bills_enabled"]:
        raise ValueError("Bill payments are temporarily unavailable.")
    if cat in (BillerCategory.AIRTIME, BillerCategory.DATA):
        net = bill_config.network_of_biller_name(biller.name)
        if net and not cfg["networks"].get(net, True):
            raise ValueError(f"{net} purchases are temporarily unavailable.")
        phone = bill_config.normalize_phone(customer_reference)
        if not phone:
            raise ValueError("Enter a valid Nigerian phone number.")
        detected = bill_config.detect_network(phone)
        if net and detected and detected != net:
            raise ValueError(f"This number looks like a {detected} line, not {net}. Check the network.")
    if cat == BillerCategory.AIRTIME and amount_kobo:
        naira = amount_kobo / 100
        if naira < cfg["min_airtime_naira"] or naira > cfg["max_airtime_naira"]:
            raise ValueError(f"Airtime must be between ₦{cfg['min_airtime_naira']:,} and ₦{cfg['max_airtime_naira']:,}.")


async def _validate_for_vend(provider, biller: Biller, customer_reference: str) -> tuple[str | None, str | None]:
    """
    Server-side validation, run again at payment time so it can't be skipped
    or tampered with by the client. Returns (validation_reference_to_send,
    validated_name). The reference is only returned when Monnify says the
    vend needs one (requireValidationRef) — it must NOT be sent otherwise.

    Billers that require validation (electricity, cable, education): any
    failure blocks the payment. Airtime/data: validation is best-effort —
    if it errors we carry on and let the vend itself accept or reject.
    """
    strict = bool(biller.requires_validation)
    try:
        result = await provider.validate_customer(product_code=biller.product_id, customer_id=customer_reference)
    except MonnifyBillsError as e:
        if strict:
            raise ValueError(e.message)
        logger.info("[bills] best-effort validation skipped for %s: %s", biller.product_id, e.message)
        return None, None

    required, ref = _read_vend_instruction(result)
    name = _read_customer_name(result)
    if required and not ref:
        if strict:
            raise ValueError("The bills provider did not return a validation reference. Please try again.")
        return None, name
    return (ref if required else None), name


def _extract_token(result: dict) -> str | None:
    instruction = result.get("vendInstruction") if isinstance(result.get("vendInstruction"), dict) else {}
    token = result.get("token") or result.get("tokenCode") or instruction.get("token")
    return str(token)[:60] if token else None


def _mark_completed(request: BillPaymentRequest, result: dict) -> None:
    request.status = BillPaymentStatus.COMPLETED
    request.token = _extract_token(result) or request.token   # present for electricity, null otherwise
    request.amount_charged_kobo = request.amount_kobo
    request.failure_reason = None
    request.completed_at = datetime.now(timezone.utc)


async def _refund(db: AsyncSession, request: BillPaymentRequest, reason: str) -> bool:
    """Give the customer their money back. Idempotent — never refunds the
    same request twice (the reversal reference is unique per request).
    Returns True if a refund was made now."""
    reference = _reversal_reference(request)
    already = (await db.execute(
        select(WalletTransaction.id).where(WalletTransaction.reference == reference)
    )).first()
    if already:
        return False
    wallet = await get_or_create_wallet(db, request.customer_id)
    await credit_wallet(
        db, wallet=wallet, amount_kobo=request.amount_kobo, category=TxCategory.REVERSAL,
        reference=reference, description=f"Refund — bill payment failed ({reason})"[:250],
        initiated_by=request.officer_id or request.customer_id,
        related_entity_type="bill_payment", related_entity_id=request.id,
    )
    return True


async def _apply_outcome(db: AsyncSession, request: BillPaymentRequest, outcome: str, result: dict) -> None:
    """Move a request to its final state from a confirmed vend/requery outcome.
    Does NOT commit — the caller does."""
    reference = result.get("transactionReference") if isinstance(result, dict) else None
    if reference:
        request.monnify_transaction_reference = str(reference)[:120]
    actor = request.officer_id or request.customer_id

    if outcome == "SUCCESS":
        _mark_completed(request, result)
        await db.flush()
        await log_action(
            db, actor_id=actor, action="bill_payment.completed",
            entity_type="bill_payment_request", entity_id=str(request.id),
            new_value={"amount_kobo": request.amount_kobo},
        )
    elif outcome == "FAILED":
        reason = (
            (result.get("responseMessage") or result.get("message")) if isinstance(result, dict) else None
        ) or "The bills provider could not complete this payment."
        await _refund(db, request, str(reason))
        request.status = BillPaymentStatus.FAILED
        request.failure_reason = str(reason)
        await db.flush()
        await log_action(
            db, actor_id=actor, action="bill_payment.failed_refunded",
            entity_type="bill_payment_request", entity_id=str(request.id),
            new_value={"amount_kobo": request.amount_kobo, "reason": str(reason)[:200]},
        )
    else:
        request.failure_reason = PENDING_NOTE
        await db.flush()


async def pay_bill(
    db: AsyncSession, *,
    customer_id: uuid.UUID,
    biller_id: uuid.UUID,
    customer_reference: str,
    amount_kobo: int | None,
    quantity: int = 1,
    validation_reference: str | None = None,   # accepted for API compatibility, ignored — see _validate_for_vend
    initiated_by: InitiatedBy,
    officer_id: uuid.UUID | None = None,
) -> BillPaymentRequest:
    """
    Money-safe order of operations:

      1. Validate, then DEBIT the wallet and COMMIT a PENDING request. The
         customer's money is now reserved and durable, and a locked wallet
         can't be spent twice.
      2. Call Monnify (no database locks held while we wait on the network).
      3. Settle from what Monnify actually said:
           SUCCESS            -> COMPLETED
           FAILED / rejected  -> refund the debit, FAILED
           in progress, timeout, unknown -> stay PENDING with the money held;
                                 resolve_pending_bill() requeries later.
         If step 3 itself fails, the request simply stays PENDING and the
         resolver finishes it — a vend is never lost or paid for twice.
    """
    biller = await db.get(Biller, biller_id)
    if not biller or not biller.is_active:
        raise ValueError("Biller not found or unavailable")

    await _enforce_director_rules(db, biller, customer_reference, amount_kobo)

    # Resolve the ACTUAL amount to charge. For fixed-price products
    # (data plans, education PINs) the biller's own price is authoritative
    # — we never trust whatever the client sent. For variable-amount
    # billers (airtime, electricity) the customer's typed amount is the
    # only source of truth, so it's required here.
    if biller.price_kobo is not None:
        resolved_amount_kobo = biller.price_kobo * quantity
    else:
        if not amount_kobo or amount_kobo <= 0:
            raise ValueError("An amount is required for this bill.")
        resolved_amount_kobo = amount_kobo

    provider = get_bills_provider()
    # Server-side validation: authoritative, ignores any client-supplied
    # reference, and only yields one when Monnify says the vend needs it.
    vend_validation_reference, validated_name = await _validate_for_vend(provider, biller, customer_reference)

    # Balance pre-check — a cheap early exit; debit_wallet below is the real,
    # row-locked check.
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
        validation_reference=vend_validation_reference,
        validated_account_name=validated_name,
        status=BillPaymentStatus.PENDING,
    )
    db.add(request)
    await db.flush()

    # ── 1. Reserve the money ──────────────────────────────────────
    try:
        await debit_wallet(
            db, wallet=wallet, amount_kobo=resolved_amount_kobo, category=TxCategory.CHARGE,
            reference=_debit_reference(request), description=f"{biller.name} — {biller.product_name}"[:250],
            initiated_by=officer_id or customer_id,
            related_entity_type="bill_payment", related_entity_id=request.id,
        )
    except HTTPException as e:
        # Insufficient balance (lost a race with another spend) or frozen wallet.
        raise ValueError(str(e.detail))
    await db.commit()   # debit + PENDING request are now durable

    # ── 2. Vend ───────────────────────────────────────────────────
    result: dict = {}
    vend_error: MonnifyBillsError | None = None
    try:
        # vend_reference = this request's own id — stable across any retry,
        # which lets Monnify recognise a repeated call as the same vend
        # instead of vending twice.
        result = await provider.vend_bill(
            product_code=biller.product_id,
            customer_id=customer_reference,
            amount_kobo=resolved_amount_kobo,
            vend_reference=str(request.id),
            validation_reference=vend_validation_reference,
        )
    except MonnifyBillsError as e:
        vend_error = e

    # ── 3. Settle ─────────────────────────────────────────────────
    try:
        if vend_error is not None and vend_error.ambiguous:
            # Timeout / dropped connection / 5xx: Monnify may have paid it.
            # Keep the money held and let the resolver requery.
            await _apply_outcome(db, request, "PENDING", {})
        elif vend_error is not None:
            # A definite rejection (could not connect, or Monnify said no).
            await _apply_outcome(db, request, "FAILED", {"message": vend_error.message})
        else:
            await _apply_outcome(db, request, vend_outcome(result), result)
        await db.commit()
    except Exception:
        logger.exception("[bills] could not settle request %s — left PENDING for resolve_pending_bill()", request.id)
        await db.rollback()
        await db.refresh(request)
    return request


async def resolve_pending_bill(db: AsyncSession, request_id: uuid.UUID) -> BillPaymentRequest | None:
    """
    Requery Monnify for a PENDING request and settle it: COMPLETED on a
    confirmed success, refund + FAILED on a confirmed failure, untouched if
    Monnify still says in-progress or can't be reached. Safe to call any
    number of times, from anywhere (a status poll, a cron script) — the row
    is locked while it runs and a refund can only ever happen once.
    """
    request = (await db.execute(
        select(BillPaymentRequest).where(BillPaymentRequest.id == request_id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if request is None or request.status != BillPaymentStatus.PENDING:
        await db.commit()   # release the lock
        return request

    provider = get_bills_provider()
    result = None
    for reference in [r for r in (request.monnify_transaction_reference, str(request.id)) if r]:
        try:
            result = await provider.requery_bill(reference)
            break
        except MonnifyBillsError as e:
            logger.info("[bills] requery of %s by %s failed: %s", request.id, reference, e.message)

    if result is None:
        await db.commit()   # release the lock; still pending
        return request

    try:
        await _apply_outcome(db, request, vend_outcome(result), result)
        await db.commit()
    except Exception:
        logger.exception("[bills] could not settle pending request %s", request.id)
        await db.rollback()
        await db.refresh(request)
    return request
