"""
Populates the billers table from Monnify's Discovery API. Run this once
before airtime/data/electricity/cable will show anything — the table is
completely empty until this has run at least once, even after the
schema migrations are applied.

Run with:  python -m scripts.sync_billers

Re-running is always safe (upserts, never duplicates) — set this up on
a daily schedule once you've confirmed it works, since biller catalogs
and prices can change on Monnify's end without you being told directly.

The first raw biller/product row Monnify returns for each category is
printed at the end, so the real field names can be checked against what
the sync reads (billerCode, productCode, name, amount/price ...).
"""
import asyncio
import json

from app.core.database import AsyncSessionLocal
from app.services.bill_payment_service import sync_billers


async def run():
    async with AsyncSessionLocal() as db:
        result = await sync_billers(db)
        print(f"Synced {result['synced']} biller/product rows.")
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


if __name__ == "__main__":
    asyncio.run(run())
