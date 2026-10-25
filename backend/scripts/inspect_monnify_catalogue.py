"""
Read-only diagnostic: shows exactly what Monnify offers THIS account, so we can
see why the catalogue is the size it is. Saves nothing to the database.

Run with:  python -m scripts.inspect_monnify_catalogue

It prints which Monnify environment it used, every category Monnify reports (and
which of them the app does NOT sync, e.g. betting), and per category how many
providers/products came back. The full detail is written to
catalogue_report.json — send that file (or the printout) back.
"""
import asyncio
import json
import sys

from app.core.config import settings
from app.integrations.monnify_bills import get_bills_provider, MonnifyBillsError
from app.services.bill_payment_service import CATEGORY_CODE_MAP, fetch_catalogue
from scripts.sync_billers import environment, print_overview


async def run() -> int:
    env = environment()
    print(f"Monnify environment: {env}  ({settings.MONNIFY_BASE_URL})")
    if env == "SANDBOX":
        print("NOTE: this is the SANDBOX — it only exposes a few test products. Use the live variables to see your real catalogue.")

    provider = get_bills_provider()
    report: dict = {"environment": env}

    try:
        categories = await provider.get_biller_categories()
    except MonnifyBillsError as e:
        print(f"\nCould not list categories: {e.message}")
        categories = []
    codes = [str(c.get("code") or c.get("categoryCode") or c.get("name")) for c in categories]
    ours = set(CATEGORY_CODE_MAP.values())
    report["categories"] = categories
    print(f"\nCategories Monnify reports ({len(codes)}): {', '.join(codes) or '—'}")
    not_synced = [c for c in codes if c not in ours]
    if not_synced:
        print(f"NOT synced by the app: {', '.join(not_synced)}")
        report["not_synced"] = {}
        for code in not_synced:
            try:
                billers = await provider.get_billers(code)
            except MonnifyBillsError as e:
                print(f"  {code}: could not list ({e.message})")
                continue
            names = sorted(str(b.get("name") or b.get("billerName") or b.get("billerCode")) for b in billers)
            report["not_synced"][code] = names
            print(f"  {code}: {len(names)} providers — {', '.join(names[:40])}{' …' if len(names) > 40 else ''}")

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
    with open("catalogue_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)
    print("\nFull report written to catalogue_report.json")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
