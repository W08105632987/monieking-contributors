"""
Read-only diagnostic: shows exactly what Monnify offers THIS account for the
services the app sells, and which other Monnify categories exist that the app
does not sell yet. Saves nothing to the database.

Run with:  python -m scripts.inspect_monnify_catalogue

It writes catalogue_report.json next to where you run it (send that file back).
Other categories (betting, gaming, internet, government collections …) are only
sampled — the first page of each — so this stays quick and gentle on your
connection. Add --directory to also crawl Monnify's full biller directory (the
BETTING bucket on this account is a catch-all containing thousands of billers).
"""
import argparse
import asyncio
import json
import sys

from app.core.config import settings
from app.integrations.monnify_bills import get_bills_provider, MonnifyBillsError
from app.services.bill_payment_service import CATALOGUE_SOURCES, fetch_catalogue, _retry_once
from scripts.sync_billers import environment, print_overview

SHOW = 40   # names printed per other category


def names_of(billers: list[dict]) -> list[str]:
    return sorted(str(b.get("name") or b.get("billerName") or b.get("billerCode")) for b in billers)


async def run(directory: bool) -> int:
    env = environment()
    print(f"Monnify environment: {env}  ({settings.MONNIFY_BASE_URL})")
    if env == "SANDBOX":
        print("NOTE: this is the SANDBOX — it only exposes a few test products. Use the live variables to see your real catalogue.")

    provider = get_bills_provider()
    report: dict = {"environment": env}

    try:
        categories = await _retry_once(lambda: provider.get_biller_categories())
    except MonnifyBillsError as e:
        print(f"\nCould not list categories: {e.message}")
        categories = []
    codes = [str(c.get("code") or c.get("categoryCode") or c.get("name")) for c in categories]
    used = {code for _cat, code, _flt in CATALOGUE_SOURCES}
    report["categories"] = codes
    print(f"\nCategories Monnify reports ({len(codes)}): {', '.join(codes) or '—'}")
    print(f"Read by the app: {', '.join(sorted(used))}")

    # 1) the services we sell — full, with product counts
    fetched = await fetch_catalogue(provider)
    print_overview(fetched["rows"], fetched["biller_counts"], fetched["empty_billers"])
    report["by_category"] = {}
    for (biller_code, product_code), r in fetched["rows"].items():
        report["by_category"].setdefault(r["category"].value, []).append({
            "biller_code": biller_code, "biller": r["biller_name"], "product_code": product_code,
            "product": r["product_name"], "price_kobo": r["price_kobo"],
        })
    report["empty_billers"] = fetched["empty_billers"]
    report["errors"] = fetched["errors"]
    report["samples"] = fetched["samples"]
    if fetched["errors"]:
        print("\nProblems while reading the catalogue (run it again — these are usually connection drops):")
        for err in fetched["errors"][:20]:
            print(f"  ! {err}")

    # 2) everything else Monnify has — sampled, so we know what else could be sold
    report["other_categories"] = {}
    others = [c for c in codes if c not in used]
    print(f"\nOther categories ({len(others)}) — first page only:")
    for code in others:
        try:
            billers = await _retry_once(lambda: provider.get_billers(code, max_pages=(50 if directory and code == "BETTING" else 1)))
        except MonnifyBillsError as e:
            print(f"  {code}: could not list ({e.message[:80]})")
            continue
        names = names_of(billers)
        report["other_categories"][code] = names
        more = f" (+{len(names) - SHOW} more)" if len(names) > SHOW else ""
        print(f"  {code}: {len(names)} providers on the first page — {', '.join(names[:SHOW])}{more}")

    with open("catalogue_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)
    print("\nFull report written to catalogue_report.json")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", action="store_true", help="also crawl the whole BETTING catch-all directory")
    args = parser.parse_args()
    sys.exit(asyncio.run(run(args.directory)))
