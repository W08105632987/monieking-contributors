"""READ-ONLY diagnostic for "all our billers are failing".

Run on the SAME machine/environment the API runs on (so it uses the same keys, base URL and outbound IP):

    python -m scripts.diagnose_monnify_bills
    python -m scripts.diagnose_monnify_bills --validate-product <PRODUCT_CODE> --customer <METER_OR_PHONE>

It NEVER vends and never writes anything. It walks the chain a bill purchase depends on, one step at a time, and prints the
REAL provider answer for each step (the app hides this from customers on purpose, and failure_reason in the database holds
only the sanitised version). The first step that fails is your cause:

  1 login            -> API key / secret / base URL wrong, or Monnify rejecting this server
  2 wallet balance   -> a vend debits your Monnify wallet first; an empty wallet fails every biller at once
  3 categories       -> Bills Payment not active, IP not allowed, or the endpoint moved
  4 billers/products -> catalogue changed or empty for airtime / data / electricity
  5 validate (opt.)  -> only the lookup step, still no money moves
"""
import argparse
import asyncio
import json
import sys
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from app.core.config import settings
from app.integrations.monnify import get_payment_provider
from app.integrations.monnify_bills import BILLS_PREFIX, MonnifyBillsError, get_bills_provider


def line(ok: bool | None, title: str, detail: str = "") -> None:
    mark = {True: "OK  ", False: "FAIL", None: "INFO"}[ok]
    print(f"[{mark}] {title}" + (f"\n        {detail}" if detail else ""))


async def main(product: str | None, customer: str | None) -> int:
    host = urlparse(settings.MONNIFY_BASE_URL).netloc
    live = "sandbox" not in host
    line(None, f"Monnify base URL: {host} ({'LIVE' if live else 'SANDBOX'})",
         f"api key set: {bool(settings.MONNIFY_API_KEY)} | secret set: {bool(settings.MONNIFY_SECRET_KEY)} | contract code set: {bool(settings.MONNIFY_CONTRACT_CODE)}")
    if live is False:
        line(False, "You are pointed at the SANDBOX", "Live bills will fail against sandbox. Check MONNIFY_BASE_URL in this environment.")

    failed = 0
    base = get_payment_provider()

    # 1. login
    try:
        token = await base._get_access_token()
        line(True, "1. Monnify login", f"token received ({len(token)} chars)")
    except HTTPException as e:
        line(False, "1. Monnify login", f"HTTP {e.status_code}: {e.detail}")
        print("\nStop here: nothing else can work until login works (keys/base URL, or Monnify blocking this server).")
        return 1

    headers = await base._headers()

    # 2. wallet balance (best effort; the endpoint needs the wallet account number)
    acct = getattr(settings, "MONNIFY_SOURCE_ACCOUNT_NUMBER", "")
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get(f"{settings.MONNIFY_BASE_URL}/api/v2/disbursements/wallet-balance", params={"accountNumber": acct}, headers=headers)
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"raw": r.text[:300]}
        rb = body.get("responseBody") or {}
        if r.status_code == 200 and rb:
            avail = rb.get("availableBalance")
            line(True, "2. Monnify wallet balance", f"available: {avail}  ledger: {rb.get('ledgerBalance')}   (wallet account {acct})")
            try:
                if avail is not None and float(avail) < 5000:
                    line(False, "   Balance is very low", "A vend debits this wallet first, so every airtime/data/electricity purchase fails when it cannot cover the cost. Top it up and retry.")
                    failed += 1
            except (TypeError, ValueError):
                pass
        else:
            line(None, "2. Monnify wallet balance (could not read)", f"HTTP {r.status_code}: {json.dumps(body)[:300]}  -> check the balance on the Monnify dashboard instead")
    except Exception as e:  # noqa: BLE001
        line(None, "2. Monnify wallet balance (could not read)", f"{type(e).__name__}: {e}  -> check the balance on the Monnify dashboard instead")

    # 3. categories
    bills = get_bills_provider()
    try:
        cats = await bills.get_biller_categories()
        names = sorted(str(c.get("name") or c.get("code") or c) for c in cats)
        line(True, "3. Bills categories", f"{len(cats)} found: {', '.join(names[:12])}")
    except MonnifyBillsError as e:
        failed += 1
        line(False, "3. Bills categories", f"REAL ERROR: {e.raw}")
        print(f"        (endpoint: {BILLS_PREFIX}/...) Read the message: 'not activated' / 'unauthorized' / 'IP' / 'deprecated' tell you exactly what to ask Monnify.")
        return 1

    # 4. billers per category the app sells
    for cat in ("AIRTIME", "DATA", "ELECTRICITY"):
        try:
            billers = await bills.get_billers(cat)
            line(bool(billers), f"4. Billers: {cat}", f"{len(billers)} billers" + ("" if billers else "  <- EMPTY, the catalogue changed or this category is not enabled"))
            failed += 0 if billers else 1
        except MonnifyBillsError as e:
            failed += 1
            line(False, f"4. Billers: {cat}", f"REAL ERROR: {e.raw}")

    # 5. optional validation (lookup only)
    if product and customer:
        try:
            res = await bills.validate_customer(product_code=product, customer_id=customer)
            line(True, "5. Validate customer", json.dumps(res)[:300])
        except MonnifyBillsError as e:
            failed += 1
            line(False, "5. Validate customer", f"REAL ERROR: {e.raw}")

    print("\n" + ("Every step answered normally. The problem is at VEND time or on our side: check the app logs for lines starting '[monnify-bills]' and '[bills]'."
                  if not failed else f"{failed} step(s) failed. The first FAIL above is your cause."))
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--validate-product")
    ap.add_argument("--customer")
    a = ap.parse_args()
    sys.exit(asyncio.run(main(a.validate_product, a.customer)))
