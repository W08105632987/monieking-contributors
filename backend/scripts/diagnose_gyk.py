"""
PROVES how GYKDATASUB really behaves and FINDS the right settings, before you switch anything on. Run it on the machine that runs the API
(same key, same IP). It spends nothing unless you pass --buy-airtime ... --yes.

    python -m scripts.diagnose_gyk                                                  # read-only discovery + checks
    python -m scripts.diagnose_gyk --buy-airtime 0801XXXXXXX --amount 100 --yes     # ONE real N100 airtime purchase to YOUR OWN number

Why it exists: their documentation, their mobile app and their live server disagree about paths and field names. Instead of guessing, this
tries each candidate path and tells you which ones exist:
  * READ-ONLY endpoints (account, plans, history) are called for real.
  * PURCHASE endpoints (airtime, data, airtime-to-cash) are called with an IMPOSSIBLE request (network 99, phone "0") that every server
    must reject. A JSON rejection proves the route exists; an HTML "File not found" proves it does not. Nothing is bought.
At the end it prints the exact GYK_* settings to put on Railway. Paste the output back; NEVER paste your API key.
"""
import argparse
import asyncio
import json
import sys

import httpx

from app.core.config import settings
from app.integrations.gyk import ID_TO_DISPLAY, VtuError, get_vtu_provider

OK, FAIL, INFO, WARN = "[ OK ]", "[FAIL]", "[INFO]", "[WARN]"

CANDIDATES = {
    "GYK_USER_PATH": ["/api/v1/user/", "/api/user/", "/api/details/user/"],
    "GYK_PLANS_PATH": ["/api/v1/dataplan/", "/api/dataplan/"],
    "GYK_HISTORY_PATH": ["/api/v1/wallet_history/", "/api/wallet_history/", "/api/v1/transactions/", "/api/v1/history/"],
    "GYK_AIRTIME_PATH": ["/api/v1/topup/", "/api/v1/airtime/", "/api/topup/", "/api/airtime/"],
    "GYK_DATA_PATH": ["/api/v1/data/", "/api/data/"],
    "GYK_A2C_PATH": ["/api/v1/a2c/", "/api/a2c/"],
}
PAYLOADS = {   # the first three are real read-only calls; the rest are impossible requests that must be rejected
    "GYK_USER_PATH": {},
    "GYK_PLANS_PATH": {"action": "allplans"},
    "GYK_HISTORY_PATH": {"action": "transactions", "page": 1, "limit": 1},
    "GYK_AIRTIME_PATH": {"network": 99, "network_id": 99, "amount": 1, "phone": "0", "reference": "diagnose"},
    "GYK_DATA_PATH": {"network": 99, "plan": 0, "plan_id": 0, "mobile_number": "0", "phone": "0", "reference": "diagnose"},
    "GYK_A2C_PATH": {"action": "otp", "network": 99, "phone": "0"},
}
READ_ONLY = {"GYK_USER_PATH", "GYK_PLANS_PATH", "GYK_HISTORY_PATH"}


async def call(path: str, payload: dict | None, *, auth: bool = True, method: str = "POST"):
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if auth:
        headers["Authorization"] = f"Bearer {settings.GYK_API_KEY}"
    async with httpx.AsyncClient(timeout=25) as c:
        return await c.request(method, f"{settings.GYK_BASE_URL.rstrip('/')}{path}", json=payload if method != "GET" else None, headers=headers)


def verdict(resp: httpx.Response) -> tuple[str, str]:
    """-> (WORKS | EXISTS | MISSING | ERROR, short detail)"""
    ctype = resp.headers.get("content-type", "")
    try:
        body = resp.json()
    except ValueError:
        body = None
    if body is None or "json" not in ctype:
        return "MISSING", f"HTTP {resp.status_code}, not JSON ({ctype.split(';')[0] or 'no type'}): {resp.text[:60].strip()!r}"
    status = str(body.get("status", "")).lower() if isinstance(body, dict) else ""
    msg = str(body.get("message", ""))[:90] if isinstance(body, dict) else ""
    if status in ("success", "ok", "true"):
        return "WORKS", f"HTTP {resp.status_code}, status success"
    return "EXISTS", f"HTTP {resp.status_code}, status {status or '?'}: {msg}"


async def main(a) -> int:
    bad = 0
    print(f"{INFO} Base URL {settings.GYK_BASE_URL}   key set: {bool(settings.GYK_API_KEY)}   account PIN set: {bool(settings.GYK_TRANSACTION_PIN)}")
    if "gykdatasub.com" in settings.GYK_BASE_URL and "kalidevelopers" not in settings.GYK_BASE_URL:
        print(f"{FAIL} GYK_BASE_URL points at their WEBSITE. The API host is https://gykdatasub15072026.kalidevelopers.com.ng")
        return 1
    if not settings.GYK_API_KEY:
        print(f"{FAIL} GYK_API_KEY is not set in this environment.")
        return 1

    print(f"\n{INFO} 1. Path discovery (nothing is bought):")
    best: dict[str, str] = {}
    for name, paths in CANDIDATES.items():
        found = None
        for path in paths:
            try:
                v, detail = verdict(await call(path, PAYLOADS[name]))
            except httpx.HTTPError as e:
                v, detail = "ERROR", f"{type(e).__name__}: {e}"
            mark = {"WORKS": OK, "EXISTS": INFO, "MISSING": "      ", "ERROR": FAIL}[v]
            print(f"   {mark} {name:17} {path:26} -> {v}: {detail}")
            if v in ("WORKS", "EXISTS") and (found is None or v == "WORKS"):
                found = path
            if v == "WORKS":
                break
        if found:
            best[name] = found
        else:
            bad += 1
    if best.get("GYK_USER_PATH") is None:
        print(f"{FAIL} The account endpoint was not found, or the key is rejected. Nothing else can work yet.")
        return 1

    # 2. Account
    resp = await call(best["GYK_USER_PATH"], {})
    body = resp.json()
    flat = json.dumps(body)[:400]
    print(f"\n{INFO} 2. Account reply (check the balance and level): {flat}")

    # 3. Plans: show the real row shape so the price column can be chosen
    resp = await call(best.get("GYK_PLANS_PATH", settings.GYK_PLANS_PATH), {"action": "allplans"})
    pb = resp.json()
    rows = pb.get("data") if isinstance(pb, dict) else None
    rows = rows if isinstance(rows, list) else []
    print(f"\n{INFO} 3. Plan list: {len(rows)} rows in the reply (total_rows={pb.get('total_rows') if isinstance(pb, dict) else '?'})")
    if rows:
        print(f"   first row: {json.dumps(rows[0])[:600]}")
        pricey = [k for k in rows[0] if any(w in k.lower() for w in ("price", "amount", "cost", "level", "smart", "agent", "api"))]
        print(f"   columns that look like prices: {pricey}")
        print(f"   {WARN} If there are several price columns, set GYK_PRICE_FIELD to the one for YOUR account level (the 'level' in step 2), then re-run.")
    try:
        parsed = await get_vtu_provider().get_all_plans()
        by_net: dict[str, int] = {}
        for p in parsed:
            by_net[p["network"]] = by_net.get(p["network"], 0) + 1
        print(f"{OK if parsed else FAIL} Parsed {len(parsed)} usable plans " + str({ID_TO_DISPLAY[k]: v for k, v in sorted(by_net.items())}))
        for p in parsed[:4]:
            print(f"        sample: {ID_TO_DISPLAY[p['network']]} id {p['variation_code']}  {p['name']}  cost N{p['amount_naira']:,.0f}")
        bad += not parsed
    except VtuError as e:
        print(f"{FAIL} Plans could not be read: {e.raw}")
        bad += 1

    # 4. Balance, fees, history through the real client
    vtu = get_vtu_provider()
    bal = await vtu.wallet_balance()
    print(f"{OK if bal is not None else FAIL} 4. Wallet balance via the app's own code: " + (f"N{bal:,.2f}" if bal is not None else "NOT readable (the balance field was not found in the reply above)"))
    bad += bal is None
    try:
        fees = await vtu.get_fees()
        print(f"{OK} 5. Fees: air_to_cash {fees.get('air_to_cash')}  mtn {fees.get('air_mtn_charges')}  airtel {fees.get('air_airtel_charges')}  glo {fees.get('air_glo_charges')}  9mobile {fees.get('air_9mobile_charges')}")
    except VtuError as e:
        print(f"{FAIL} 5. Fees: {e.raw}")
        bad += 1
    from datetime import datetime, timedelta, timezone
    found = await vtu.find_purchase(phone="08000000000", since=datetime.now(timezone.utc) - timedelta(days=1))
    print(f"{OK if found is not None else FAIL} 6. Wallet history genuinely readable (a refused call no longer counts as 'readable'): {'yes' if found is not None else 'NO'}")
    bad += found is None

    # 5. Optional real purchase
    if a.buy_airtime:
        if not a.yes:
            print(f"\n{INFO} 7. Skipped the real purchase: add --yes to actually spend N{a.amount}.")
        else:
            result = await vtu.buy_airtime(network=a.network, phone=a.buy_airtime, amount_naira=a.amount, idempotency_key="diagnose-test")
            print(f"\n{INFO} 7. Real N{a.amount} airtime to {a.buy_airtime}: outcome {result['vendStatus']}, reference {result.get('transactionReference')}, message {result.get('responseMessage')!r}")
            if "_error" in result:
                e = result["_error"]
                print(f"        classified as: {'AMBIGUOUS (would be held)' if e.ambiguous else 'definite ' + e.kind + ' failure'}: {e.raw}")
            print("        CHECK THE PHONE: did the airtime arrive? Tell the developer.")

    print("\n=== Put these on Railway (API service, celery-worker AND celery-beat) ===")
    for name in CANDIDATES:
        print(f"{name}={best.get(name, '??? not found: ask GYKDATASUB support for the correct path')}")
    print("\n" + ("All checks passed." if not bad else f"{bad} check(s) need attention before enabling VTU."))
    return 1 if bad else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--buy-airtime", help="your OWN phone number")
    ap.add_argument("--amount", type=int, default=100)
    ap.add_argument("--network", default="1", help="1 MTN, 2 Glo, 3 9mobile, 4 Airtel")
    ap.add_argument("--yes", action="store_true", help="really spend the money")
    sys.exit(asyncio.run(main(ap.parse_args())))
