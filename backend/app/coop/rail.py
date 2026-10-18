"""
Money rail: the one place where the cooperative's books touch a real wallet.

Today the rail is the cooperative's own book only (test_ledger). When live funds are switched on AND the rule
`money_rail` is `wallet`, contributions and repayments debit the member's MonieKing wallet and withdrawals,
loan payouts and dividends credit it. Nothing else in the module knows about wallets, so a different rail
(a Monnify sub-account, a bank API) is a change to this file only.

The wallet service only knows a fixed list of transaction categories, so the rail uses the closest existing
ones (CONTRIBUTION for money going in, WALLET_FUNDING for money coming out) and puts the real meaning in the
description and in related_entity_type="coop".
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.coop.errors import CoopError
from app.coop.settings_store import Rules


def is_wallet_rail(rules: Rules) -> bool:
    return bool(rules.get("coop_live_funds")) and rules.get("money_rail") == "wallet"


async def debit_member(db: AsyncSession, rules: Rules, user_id: uuid.UUID, amount: int, reference: str, description: str) -> None:
    """Money going INTO the cooperative from the member's wallet. No-op on the test ledger."""
    if not is_wallet_rail(rules) or amount <= 0:
        return
    from app.models.wallet import TxCategory
    from app.services.wallet_service import debit_wallet, get_or_create_wallet
    wallet = await get_or_create_wallet(db, user_id)
    if wallet.is_frozen:
        raise CoopError("Your wallet is frozen. Please contact support.", 409, "wallet_frozen")
    try:
        await debit_wallet(db, wallet=wallet, amount_kobo=amount, category=TxCategory.CONTRIBUTION, reference=f"coop:{reference}",
                           description=f"Cooperative: {description}", initiated_by=user_id, related_entity_type="coop")
    except Exception as e:  # insufficient funds etc. come back as an HTTPException
        detail = getattr(e, "detail", None)
        raise CoopError(str(detail or "Your wallet balance is too low"), 409, "wallet_debit_failed")


async def credit_member(db: AsyncSession, rules: Rules, user_id: uuid.UUID, amount: int, reference: str, description: str, actor: uuid.UUID | None = None) -> None:
    """Money going OUT of the cooperative into the member's wallet. No-op on the test ledger."""
    if not is_wallet_rail(rules) or amount <= 0:
        return
    from app.models.wallet import TxCategory
    from app.services.wallet_service import credit_wallet, get_or_create_wallet
    wallet = await get_or_create_wallet(db, user_id)
    await credit_wallet(db, wallet=wallet, amount_kobo=amount, category=TxCategory.WALLET_FUNDING, reference=f"coop:{reference}",
                        description=f"Cooperative: {description}", initiated_by=actor or user_id, related_entity_type="coop")
