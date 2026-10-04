"""
Wallet service — all balance operations use SELECT FOR UPDATE to prevent race conditions.
All monetary values in kobo (integers).
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.wallet import Wallet, WalletTransaction, TxType, TxCategory
from app.core.security import generate_reference
from fastapi import HTTPException, status


async def get_or_create_wallet(db: AsyncSession, owner_id: uuid.UUID) -> Wallet:
    result = await db.execute(select(Wallet).where(Wallet.owner_id == owner_id))
    wallet = result.scalar_one_or_none()
    if not wallet:
        wallet = Wallet(owner_id=owner_id)
        db.add(wallet)
        await db.flush()
    return wallet


async def credit_wallet(
    db: AsyncSession,
    *,
    wallet: Wallet,
    amount_kobo: int,
    category: TxCategory,
    reference: str,
    description: str,
    initiated_by: uuid.UUID,
    related_card_id: uuid.UUID | None = None,
    related_entity_type: str | None = None,
    related_entity_id: uuid.UUID | None = None,
) -> WalletTransaction:
    """
    Credit wallet balance. Uses row-level lock.

    BUG MK-WALLET-001 FIX: the caller's `wallet` argument may already be a
    loaded object sitting in this session's identity map (e.g. from
    get_or_create_wallet earlier in the same request). Without
    populate_existing=True, SQLAlchemy's default behavior on a repeat
    SELECT for a primary key it already has in the identity map is to
    hand back the SAME Python object with its ORIGINAL (pre-lock)
    attribute values — the SELECT ... FOR UPDATE genuinely runs and
    genuinely blocks at the SQL level, but the balance this function
    then reads and mutates is the stale, pre-lock one, not the row it
    just locked. Two near-simultaneous requests can both pass a balance
    check against the same stale number. populate_existing=True forces
    SQLAlchemy to overwrite the cached object's attributes with what
    this SELECT actually returns, so `locked_wallet.balance_kobo` below
    is genuinely the just-locked, up-to-date value.
    """
    result = await db.execute(
        select(Wallet).where(Wallet.id == wallet.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    locked_wallet = result.scalar_one()

    if locked_wallet.is_frozen:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Wallet is frozen")

    locked_wallet.balance_kobo += amount_kobo
    new_balance = locked_wallet.balance_kobo

    tx = WalletTransaction(
        wallet_id=         locked_wallet.id,
        type=              TxType.CREDIT,
        category=          category,
        amount_kobo=       amount_kobo,
        balance_after_kobo=new_balance,
        reference=         reference,
        description=       description,
        initiated_by=      initiated_by,
        related_card_id=   related_card_id,
        related_entity_type=related_entity_type,
        related_entity_id=  related_entity_id,
    )
    db.add(tx)
    await db.flush()
    return tx


async def debit_wallet(
    db: AsyncSession,
    *,
    wallet: Wallet,
    amount_kobo: int,
    category: TxCategory,
    reference: str,
    description: str,
    initiated_by: uuid.UUID,
    related_card_id: uuid.UUID | None = None,
    related_withdrawal_id: uuid.UUID | None = None,
    related_entity_type: str | None = None,
    related_entity_id: uuid.UUID | None = None,
    allow_negative: bool = False,
) -> WalletTransaction:
    """
    Debit wallet balance. Raises 400 if insufficient funds unless allow_negative=True
    (used for automated monthly SMS subscription overdrafts).

    Same MK-WALLET-001 fix as credit_wallet above — see that docstring
    for the full mechanism. This is the more dangerous of the two sites,
    since it's the one that gates real external money movement
    (Monnify disbursement, bill vend) in withdrawals.py,
    bill_payment_service.py, and identity_services.py.
    """
    result = await db.execute(
        select(Wallet).where(Wallet.id == wallet.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    locked_wallet = result.scalar_one()

    if locked_wallet.is_frozen:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Wallet is frozen")

    if not allow_negative and locked_wallet.balance_kobo < amount_kobo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient wallet balance. Available: ₦{locked_wallet.balance_kobo // 100:,}",
        )

    locked_wallet.balance_kobo -= amount_kobo
    new_balance = locked_wallet.balance_kobo

    tx = WalletTransaction(
        wallet_id=              locked_wallet.id,
        type=                   TxType.DEBIT,
        category=               category,
        amount_kobo=            amount_kobo,
        balance_after_kobo=     new_balance,
        reference=              reference,
        description=            description,
        initiated_by=           initiated_by,
        related_card_id=        related_card_id,
        related_withdrawal_id=  related_withdrawal_id,
        related_entity_type=    related_entity_type,
        related_entity_id=      related_entity_id,
    )
    db.add(tx)
    await db.flush()
    return tx
