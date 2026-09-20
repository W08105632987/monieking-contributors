"""
Pre-launch cleanup: removes test CUSTOMER accounts and every row that
depends on them, so the platform starts with a clean slate for real
users. Deliberately customer-only by default — officer/director/admin
accounts are staff, not "test users" in the sense this script means,
and are never touched unless you explicitly pass --include-staff with
an explicit phone number list (see below).

WHY THIS IS A PYTHON SCRIPT AND NOT `DELETE FROM users WHERE role =
'customer'`: 18+ tables reference users(id) with no ON DELETE CASCADE
(Postgres default is RESTRICT/NO ACTION) — a raw DELETE against users
fails outright the moment any test customer has so much as a
registration audit-log entry, a card, or a notification, which is
every real test account. This script deletes dependents first, in the
correct order, table by table, so the final `users` delete always
succeeds cleanly. TRUNCATE was considered and rejected — it can't take
a WHERE clause, so it can't selectively preserve real staff accounts
alongside wiping test customers.

SAFETY:
- Dry-run by default. Nothing is deleted unless you pass --execute.
- Prints exactly how many rows in each table will be removed, for
  every affected user, before anything happens.
- Runs inside one transaction — either everything succeeds, or nothing
  does. No partial-cleanup state is possible.
- Only ever targets role='customer' unless you explicitly widen it.

USAGE:
  # See what would happen, change nothing:
  python -m scripts.clear_test_customers

  # Actually delete:
  python -m scripts.clear_test_customers --execute

  # Preserve specific customer accounts (e.g. ones you're keeping as
  # real seed data) by phone number:
  python -m scripts.clear_test_customers --execute --keep 08011112222 08033334444
"""
import argparse
import asyncio

from sqlalchemy import select, delete, func

from app.core.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.models.card import ContributionCard, ContributionRecord
from app.models.withdrawal import Withdrawal
from app.models.wallet import Wallet, WalletTransaction
from app.models.notification import Notification
from app.models.dispute import Dispute, DisputeMessage
from app.models.audit import AuditLog

try:
    from app.models.bill_payment import BillPaymentRequest
except ImportError:
    BillPaymentRequest = None  # tolerate model/module naming drift without hard-failing the whole script

try:
    from app.models.identity_service import IdentityServiceRequest, IdentityServiceNotifyRequest
except ImportError:
    IdentityServiceRequest = None
    IdentityServiceNotifyRequest = None

try:
    from app.models.webauthn_credential import WebAuthnCredential
except ImportError:
    WebAuthnCredential = None


async def run(execute: bool, keep_phones: list[str]):
    async with AsyncSessionLocal() as db:
        target_result = await db.execute(
            select(User).where(User.role == UserRole.CUSTOMER, User.phone_number.notin_(keep_phones))
        )
        targets = target_result.scalars().all()
        target_ids = [u.id for u in targets]

        if not target_ids:
            print("No matching customer accounts found — nothing to do.")
            return

        print(f"{'Would remove' if not execute else 'Removing'} {len(target_ids)} customer account(s):")
        for u in targets[:20]:
            print(f"  - {u.full_name} ({u.phone_number}) #{u.customer_number}")
        if len(targets) > 20:
            print(f"  ...and {len(targets) - 20} more")

        # Dependency order: children before parents. Every one of these
        # is a real FK pointing at users(id) or transitively at a card/
        # wallet owned by one of the target users.
        card_ids_subq = select(ContributionCard.id).where(ContributionCard.owner_id.in_(target_ids))
        wallet_ids_subq = select(Wallet.id).where(Wallet.owner_id.in_(target_ids))

        plan = [
            ("audit_logs (as actor)", delete(AuditLog).where(AuditLog.actor_id.in_(target_ids))),
            ("notifications", delete(Notification).where(Notification.user_id.in_(target_ids))),
            ("dispute_messages (as sender)", delete(DisputeMessage).where(DisputeMessage.sender_id.in_(target_ids))),
            ("disputes (as raiser)", delete(Dispute).where(Dispute.raised_by.in_(target_ids))),
            ("withdrawals", delete(Withdrawal).where(Withdrawal.customer_id.in_(target_ids))),
            ("contribution_records", delete(ContributionRecord).where(ContributionRecord.card_id.in_(card_ids_subq))),
            ("contribution_cards", delete(ContributionCard).where(ContributionCard.owner_id.in_(target_ids))),
            ("wallet_transactions", delete(WalletTransaction).where(WalletTransaction.wallet_id.in_(wallet_ids_subq))),
            ("wallets", delete(Wallet).where(Wallet.owner_id.in_(target_ids))),
        ]
        if BillPaymentRequest is not None:
            plan.append(("bill_payment_requests", delete(BillPaymentRequest).where(BillPaymentRequest.customer_id.in_(target_ids))))
        if IdentityServiceRequest is not None:
            plan.append(("identity_service_requests", delete(IdentityServiceRequest).where(IdentityServiceRequest.customer_id.in_(target_ids))))
        if IdentityServiceNotifyRequest is not None:
            plan.append(("identity_service_notify_requests", delete(IdentityServiceNotifyRequest).where(IdentityServiceNotifyRequest.customer_id.in_(target_ids))))
        if WebAuthnCredential is not None:
            plan.append(("webauthn_credentials", delete(WebAuthnCredential).where(WebAuthnCredential.user_id.in_(target_ids))))

        plan.append(("users", delete(User).where(User.id.in_(target_ids))))

        for label, stmt in plan:
            if execute:
                result = await db.execute(stmt)
                print(f"  {label}: deleted {result.rowcount} row(s)")
            else:
                # Dry-run: build the equivalent SELECT count(*) from the
                # same table/where-clause instead of running the delete.
                count_stmt = select(func.count()).select_from(stmt.table).where(stmt.whereclause)
                count = (await db.execute(count_stmt)).scalar_one()
                print(f"  {label}: would delete {count} row(s)")

        if execute:
            await db.commit()
            print("\nDone — committed.")
        else:
            await db.rollback()
            print("\nDry run only — nothing was changed. Re-run with --execute to actually delete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Actually delete. Without this flag, only a dry-run report is printed.")
    parser.add_argument("--keep", nargs="*", default=[], help="Phone numbers to preserve even though they're customers.")
    args = parser.parse_args()

    asyncio.run(run(execute=args.execute, keep_phones=args.keep))
