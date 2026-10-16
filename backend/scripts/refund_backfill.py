"""One-time: refund failed manual jobs that were charged but never refunded (everything
that failed before the refund engine existed).

  python -m scripts.refund_backfill                       # DRY RUN: counts and totals only
  python -m scripts.refund_backfill --apply --actor <director user id>

Prints counts and totals only, never customer details. Safe to re-run: each refund has a
unique reference per job, so a job is never refunded twice. Commissions already paid on
those jobs are untouched (failed jobs paid none)."""
import argparse
import asyncio
import uuid

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.manual_service_request import ManualServiceRequest, ManualServiceStatus
from app.services.refund_service import refund_manual_job


async def main(apply: bool, actor: str | None) -> None:
    if apply and not actor:
        raise SystemExit("--actor <director user id> is required with --apply")
    done = total = skipped = 0
    async with AsyncSessionLocal() as db:
        jobs = (await db.scalars(select(ManualServiceRequest).where(
            ManualServiceRequest.status == ManualServiceStatus.FAILED))).all()
        for job in jobs:
            if not apply:
                # dry run: do the real work inside a savepoint and roll it back
                try:
                    async with db.begin_nested() as sp:
                        amt = await refund_manual_job(db, job, actor_id=job.user_id, why="backfill dry run")
                        await sp.rollback()
                except ValueError:
                    skipped += 1
                    continue
            else:
                try:
                    async with db.begin_nested():
                        amt = await refund_manual_job(db, job, actor_id=uuid.UUID(actor), why="backfill of earlier failures")
                except ValueError:
                    skipped += 1
                    continue
            if amt:
                done += 1
                total += amt
        if apply:
            await db.commit()
        else:
            await db.rollback()
    print(f"{'APPLIED' if apply else 'DRY RUN'}: {done} jobs, total {total / 100:,.2f} naira, {skipped} skipped")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--actor")
    a = ap.parse_args()
    asyncio.run(main(a.apply, a.actor))
