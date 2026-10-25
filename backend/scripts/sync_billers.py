"""
Populates the billers table from Monnify's Discovery API.

Run with:   python -m scripts.sync_billers            (save to the database)
            python -m scripts.sync_billers --dry-run   (fetch and report only, nothing is saved)

Re-running is always safe (upserts, never duplicates). Run it after Monnify
changes your catalogue, or on a daily schedule.

IMPORTANT — it syncs whatever Monnify environment your variables point at.
Sandbox has only a handful of test products; live has your real catalogue. So it
prints which one it is talking to and REFUSES to save a sandbox catalogue unless
you pass --allow-sandbox (this is what stops test product codes ending up in a
production database).
"""
import argparse
import asyncio
import json
import sys

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.services.bill_payment_service import fetch_catalogue, sync_billers


def environment() -> str:
    return "SANDBOX" if "sandbox" in (settings.MONNIFY_BASE_URL or "").lower() else "LIVE"


def db_host() -> str:
    return (settings.DATABASE_URL or "").split("@")[-1].split("/")[0] or "unknown"


def print_overview(rows: dict, biller_counts: dict, empty_billers: dict) -> None:
    """Who is in the catalogue, per category — easy to compare against what you expect."""
    by_cat: dict[str, dict[str, int]] = {}
    for (biller_code, _product), r in rows.items():
        by_cat.setdefault(r["category"].value, {}).setdefault(r["biller_name"], 0)
        by_cat[r["category"].value][r["biller_name"]] += 1
    print("\nWhat Monnify returned for this account:")
    for category in ("airtime", "data", "electricity", "cable_tv", "education"):
        providers = by_cat.get(category, {})
        total = sum(providers.values())
        print(f"\n  {category.upper()}: {total} products across {len(providers)} providers "
              f"({biller_counts.get(category, 0)} providers listed by Monnify, {len(empty_billers.get(category, []))} of them with no products for you)")
        for name, n in sorted(providers.items())[:60]:
            print(f"      - {name}  ({n})")
        if len(providers) > 60:
            print(f"      … and {len(providers) - 60} more")


async def run(dry_run: bool, allow_sandbox: bool) -> int:
    env = environment()
    print(f"Monnify environment: {env}  ({settings.MONNIFY_BASE_URL})")
    print(f"Database:            {db_host()}")
    if env == "SANDBOX" and not allow_sandbox:
        print("\nRefusing to continue: this is the SANDBOX, which only has a few test products. Saving them would put "
              "test product codes in your database. Use the live Monnify variables (e.g. `railway run`), or pass "
              "--allow-sandbox if you really do want the sandbox catalogue (e.g. on a development database).")
        return 2

    if dry_run:
        fetched = await fetch_catalogue()
        print_overview(fetched["rows"], fetched["biller_counts"], fetched["empty_billers"])
        print(f"\nDRY RUN: {len(fetched['rows'])} products found, nothing saved.")
        for err in fetched["errors"]:
            print(f"  ! {err}")
        return 0

    async with AsyncSessionLocal() as db:
        result = await sync_billers(db)
    print(f"\nSynced {result['synced']} biller/product rows.")
    if result.get("counts"):
        print("By category: " + ", ".join(f"{k}={v}" for k, v in sorted(result["counts"].items())))
    if result.get("deactivated"):
        print(f"Deactivated {result['deactivated']} product(s) Monnify no longer lists.")
    if result["errors"]:
        print(f"\n{len(result['errors'])} issue(s) — none of these stopped the sync, but check them:")
        for err in result["errors"]:
            print(f"  - {err}")
    samples = result.get("samples") or {}
    if samples:
        print("\nFirst raw row Monnify returned per category (check the field names):")
        for category, rows in samples.items():
            print(f"\n[{category}]")
            for kind, row in rows.items():
                print(f"  {kind}: {json.dumps(row, default=str)[:600]}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="fetch and report, save nothing")
    parser.add_argument("--allow-sandbox", action="store_true", help="allow saving a sandbox catalogue")
    args = parser.parse_args()
    sys.exit(asyncio.run(run(args.dry_run, args.allow_sandbox)))
