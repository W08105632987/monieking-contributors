import logging
import re
import uuid
import asyncio
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bill_payment import Biller, BillPaymentRequest, BillPaymentStatus, BillerCategory
from app.models.identity_service import InitiatedBy
from app.models.wallet import TxCategory, WalletTransaction
from app.services.wallet_service import get_or_create_wallet, debit_wallet, credit_wallet
from app.integrations.monnify_bills import get_bills_provider, MonnifyBillsError, vend_outcome
from app.utils.audit import log_action
from app.services import bill_config, bill_pricing

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


# Where each of our categories comes from in Monnify. Confirmed from this account's
# own biller-categories response (live): Monnify keeps the network data plans in
# DATA_BUNDLE (MTN, AIRTEL, GLO, 9MOBILE, VITEL), and at least one DISCO's postpaid
# product sits under TRANSPORTATION, so that category is read too but only for
# electricity-looking billers. Several sources can feed one category of ours.
#   (our category, Monnify categoryCode, optional name filter)
ELECTRICITY_NAME = re.compile(r"electric|disco|power|distribution", re.I)
CATALOGUE_SOURCES: list[tuple[BillerCategory, str, "re.Pattern | None"]] = [
    (BillerCategory.AIRTIME, "AIRTIME", None),
    (BillerCategory.DATA, "DATA", None),
    (BillerCategory.DATA, "DATA_BUNDLE", None),
    (BillerCategory.ELECTRICITY, "ELECTRICITY", None),
    (BillerCategory.ELECTRICITY, "TRANSPORTATION", ELECTRICITY_NAME),
    (BillerCategory.CABLE_TV, "CABLE_TV", None),
    (BillerCategory.EDUCATION, "EDUCATION", None),
]
# Kept for older callers: our category -> its main Monnify code.
CATEGORY_CODE_MAP = {cat: code for cat, code, flt in CATALOGUE_SOURCES if flt is None and code != "DATA_BUNDLE"}

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


# Monnify lists data bundles inside the AIRTIME category's network billers
# (e.g. biller AIRTEL has the variable "Airtel Mobile Top up" AND fixed-price
# "2GB 30 Days" plans). The Data screen and the director's data switches work
# off category = data, so fixed-price products found under AIRTIME are filed as DATA.

SYNC_CONCURRENCY = 4


def _classify(category: BillerCategory, product_name: str, price_kobo: int | None) -> BillerCategory:
    """Plain airtime is a variable amount (no fixed price). A fixed-price product
    under the AIRTIME category is a bundle, so it is filed as DATA."""
    if category == BillerCategory.AIRTIME and price_kobo is not None:
        return BillerCategory.DATA
    return category


async def _retry_once(call, delays=(1.0, 3.0)):
    """Retry transient provider/network errors, pausing between tries (1s, then 3s)."""
    for delay in delays:
        try:
            return await call()
        except MonnifyBillsError as e:
            if not e.retriable:
                raise
            await asyncio.sleep(delay)
    return await call()


async def fetch_catalogue(provider=None) -> dict:
    """
    Reads the whole catalogue from Monnify. Touches NO database, so no
    connection is held open while the (slow) HTTP calls run — the earlier
    version kept one transaction open for the whole crawl and the pooler
    killed it before the final save.

    Returns {"rows": {(biller_code, product_code): {...}}, "errors": [...],
             "samples": {...}, "all_clean": bool}.
    """
    provider = provider or get_bills_provider()
    rows: dict[tuple[str, str], dict] = {}
    errors: list[str] = []
    samples: dict[str, dict] = {}
    empty_billers: dict[str, list[str]] = {}
    biller_counts: dict[str, int] = {}
    all_clean = True
    gate = asyncio.Semaphore(SYNC_CONCURRENCY)

    async def products_for(code: str):
        async with gate:
            return await _retry_once(lambda: provider.get_biller_products(code))

    for internal_category, monnify_category_code, name_filter in CATALOGUE_SOURCES:
        try:
            billers = await _retry_once(lambda: provider.get_billers(monnify_category_code))
        except MonnifyBillsError as e:
            errors.append(f"{internal_category.value}: couldn't list billers ({e.message})")
            all_clean = False
            continue

        if name_filter is not None:
            billers = [b for b in billers if name_filter.search(str(b.get("name") or b.get("billerName") or ""))]
        biller_counts[internal_category.value] = biller_counts.get(internal_category.value, 0) + len(billers)
        if billers:
            samples.setdefault(internal_category.value, {})["biller"] = billers[0]

        valid: list[tuple[str, str]] = []
        for biller_row in billers:
            raw_code = biller_row.get("billerCode") or biller_row.get("code")
            if not raw_code:
                errors.append(f"{internal_category.value}: a biller row had no billerCode, skipped: {biller_row}")
                all_clean = False
                continue
            code = str(raw_code)[:80]
            valid.append((code, str(biller_row.get("name") or biller_row.get("billerName") or code)[:160]))

        results = await asyncio.gather(*(products_for(code) for code, _ in valid), return_exceptions=True)

        for (biller_code, biller_name), result in zip(valid, results):
            if isinstance(result, MonnifyBillsError):
                errors.append(f"{biller_name}: couldn't list products ({result.message})")
                all_clean = False
                continue
            if isinstance(result, BaseException):
                raise result

            if not result:
                empty_billers.setdefault(internal_category.value, []).append(biller_name)
            if result and "product" not in samples.get(internal_category.value, {}):
                samples.setdefault(internal_category.value, {})["product"] = result[0]

            for product_row in result:
                raw_product = product_row.get("productCode") or product_row.get("code")
                if not raw_product:
                    errors.append(f"{biller_name}: a product row had no productCode, skipped: {product_row}")
                    all_clean = False
                    continue
                product_code = str(raw_product)[:80]
                key = (biller_code, product_code)
                if key in rows:
                    continue   # same pair under two categories: first one wins (unique constraint)
                product_name = str(product_row.get("name") or product_row.get("productName") or product_code)[:160]
                price_type = str(product_row.get("priceType") or "").upper()
                price_kobo = None if price_type == "OPEN" else _price_to_kobo(product_row.get("amount") or product_row.get("price"))
                category = _classify(internal_category, product_name, price_kobo)
                rows[key] = {
                    "category": category,
                    "biller_name": biller_name,
                    "product_name": product_name,
                    "price_kobo": price_kobo,
                    "min_amount_kobo": _price_to_kobo(product_row.get("minAmount")),
                    "max_amount_kobo": _price_to_kobo(product_row.get("maxAmount")),
                    "requires_validation": (
                        bool(product_row.get("requireValidationRef") or product_row.get("requiresValidation"))
                        or category in VALIDATION_REQUIRED_CATEGORIES
                    ),
                }
    return {
        "rows": rows, "errors": errors, "samples": samples, "all_clean": all_clean,
        "biller_counts": biller_counts, "empty_billers": empty_billers,
    }


async def _write_catalogue(db: AsyncSession, rows: dict, deactivate_missing: bool) -> tuple[int, int]:
    """Saves the fetched catalogue. One read of the existing rows, in-memory
    upsert, one commit — a short transaction instead of hundreds of round
    trips. Existing rows are never re-activated (a director's hide stays)."""
    existing_rows = (await db.execute(select(Biller))).scalars().all()
    existing = {(b.monnify_biller_id, b.product_id): b for b in existing_rows}
    now = datetime.now(timezone.utc)
    synced = 0
    for (biller_code, product_code), r in rows.items():
        biller = existing.get((biller_code, product_code))
        if biller:
            biller.category = r["category"]
            biller.name = r["biller_name"]
            biller.product_name = r["product_name"]
            biller.price_kobo = r["price_kobo"]
            biller.min_amount_kobo = r.get("min_amount_kobo")
            biller.max_amount_kobo = r.get("max_amount_kobo")
            biller.requires_validation = r["requires_validation"]
            # commission_percent / markup_percent / customer_price_kobo are the director's — never touched here.
            biller.last_synced_at = now
        else:
            db.add(Biller(
                monnify_biller_id=biller_code, category=r["category"], name=r["biller_name"],
                product_id=product_code, product_name=r["product_name"], price_kobo=r["price_kobo"],
                min_amount_kobo=r.get("min_amount_kobo"), max_amount_kobo=r.get("max_amount_kobo"),
                commission_percent=bill_pricing.default_commission_percent(r["category"], r["biller_name"]),
                requires_validation=r["requires_validation"], is_active=True,
            ))
        synced += 1
        if synced % 150 == 0:
            await db.flush()

    deactivated = 0
    if deactivate_missing and rows:
        for key, biller in existing.items():
            if key not in rows and biller.is_active:
                biller.is_active = False
                deactivated += 1
    await db.commit()
    return synced, deactivated


async def sync_billers(db: AsyncSession) -> dict:
    """
    Populates/refreshes the billers table from Monnify's live Discovery API.
    Without this having run at least once, GET /bill-payments/billers
    always returns an empty list for every category.

    Phase 1 reads everything from Monnify (no database connection held).
    Phase 2 writes it in one short transaction, retried once if the database
    connection drops. Upserts on (monnify_biller_id, product_id) — matches the
    table's UNIQUE constraint — so re-running is always safe.

    - A director's manual hide (is_active = False) is respected: existing
      rows are never re-activated by a sync.
    - A product Monnify no longer lists is deactivated, but only when every
      category synced cleanly, so a transient error can't wipe the catalogue.
    - `samples` returns the first raw biller/product row per category so the
      real Monnify field names can be checked against what we read.
    """
    fetched = await fetch_catalogue()
    rows = fetched["rows"]
    synced = deactivated = 0
    if rows:
        for attempt in (1, 2):
            try:
                synced, deactivated = await _write_catalogue(db, rows, fetched["all_clean"])
                break
            except DBAPIError:
                await db.rollback()
                if attempt == 2:
                    raise
                logger.warning("[bills] database connection dropped while saving the catalogue — retrying once")

    counts: dict[str, int] = {}
    for r in rows.values():
        counts[r["category"].value] = counts.get(r["category"].value, 0) + 1
    return {
        "synced": synced, "deactivated": deactivated, "errors": fetched["errors"],
        "samples": fetched["samples"], "counts": counts,
        "biller_counts": fetched["biller_counts"], "empty_billers": fetched["empty_billers"],
    }


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
    instruction = result.get("vendInstruction") if isinstance(result.get("vendInstruction"), dict) else {}
    for source in (result, instruction):
        for key in ("customerName", "customerFullName", "accountName", "customerAccountName", "fullName", "name"):
            value = source.get(key)
            if value and isinstance(value, str):
                return value[:160]
    return None


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


_TOKEN_KEYS = ("token", "tokenCode", "tokenValue", "meterToken", "electricityToken", "pin", "stsToken")
_TOKEN_TEXT = re.compile(r"(?i)token\s*(?:no\.?|number|code)?\s*[:=\-]?\s*((?:\d[\s-]?){10,30})")


def _find_token(node, depth: int = 0) -> str | None:
    """Look for a token anywhere in a provider response — the field name and nesting differ between providers."""
    if depth > 4:
        return None
    if isinstance(node, dict):
        for key in _TOKEN_KEYS:
            value = node.get(key)
            if value is not None and not isinstance(value, (dict, list)) and str(value).strip():
                return str(value).strip()
        for value in node.values():
            if isinstance(value, (dict, list)):
                found = _find_token(value, depth + 1)
                if found:
                    return found
        for key in ("description", "message", "responseMessage", "narration", "vendDescription"):
            value = node.get(key)
            if isinstance(value, str):
                match = _TOKEN_TEXT.search(value)
                if match:
                    return match.group(1).strip()
    elif isinstance(node, list):
        for item in node:
            found = _find_token(item, depth + 1)
            if found:
                return found
    return None


def _extract_token(result: dict) -> str | None:
    token = _find_token(result)
    return token[:60] if token else None


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
    sale = bill_pricing.quote(biller, amount_kobo=amount_kobo, quantity=quantity)
    resolved_amount_kobo = sale.charge_kobo          # what the customer's wallet pays
    # Monnify's own limits for variable-amount products (airtime from ₦100, electricity from ₦1,000 ...)
    if not bill_pricing.is_fixed(biller):
        low, high = getattr(biller, "min_amount_kobo", None), getattr(biller, "max_amount_kobo", None)
        if low and sale.vend_kobo < low:
            raise ValueError(f"The minimum for this product is ₦{low / 100:,.0f}.")
        if high and sale.vend_kobo > high:
            raise ValueError(f"The maximum for this product is ₦{high / 100:,.0f}.")

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
        vend_amount_kobo=sale.vend_kobo,
        commission_kobo=sale.commission_kobo,
        markup_kobo=sale.markup_kobo,
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
            amount_kobo=sale.vend_kobo,                  # Monnify is asked for the face value, not our price
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


async def backfill_missing_token(db: AsyncSession, request: BillPaymentRequest) -> BillPaymentRequest:
    """
    A COMPLETED electricity purchase whose token was never saved (the provider
    sent it in a shape we did not read, or only after the first response):
    ask the provider again and store the token. Only the token is written —
    status and money are never touched here. Safe to call repeatedly; it does
    nothing once a token is stored or for non-electricity products.
    """
    if request.status != BillPaymentStatus.COMPLETED or request.token:
        return request
    biller = await db.get(Biller, request.biller_id)
    if not biller or biller.category != BillerCategory.ELECTRICITY:
        return request

    provider = get_bills_provider()
    for reference in [r for r in (request.monnify_transaction_reference, str(request.id)) if r]:
        try:
            result = await provider.requery_bill(reference)
        except MonnifyBillsError as e:
            logger.info("[bills] token requery of %s by %s failed: %s", request.id, reference, e.message)
            continue
        token = _extract_token(result) if isinstance(result, dict) else None
        if token:
            request.token = token
            await db.commit()
            logger.info("[bills] recovered missing token for request %s", request.id)
            return request
    return request
