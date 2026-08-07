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
) -> WalletTransaction:
    """Credit wallet balance. Uses row-level lock."""
    # Re-fetch with lock
    result = await db.execute(
        select(Wallet).where(Wallet.id == wallet.id).with_for_update()
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
) -> WalletTransaction:
    """Debit wallet balance. Raises 400 if insufficient funds."""
    result = await db.execute(
        select(Wallet).where(Wallet.id == wallet.id).with_for_update()
    )
    locked_wallet = result.scalar_one()

    if locked_wallet.is_frozen:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Wallet is frozen")

    if locked_wallet.balance_kobo < amount_kobo:
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
    )
    db.add(tx)
    await db.flush()
    return tx
