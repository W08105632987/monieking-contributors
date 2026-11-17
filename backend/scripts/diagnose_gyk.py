"""
PROVES how GYKDATASUB really behaves, before you switch anything on. Run it on the machine that runs the API (same key, same IP):

    python -m scripts.diagnose_gyk                                   # read-only: key, wallet, plans, fees, history
    python -m scripts.diagnose_gyk --buy-airtime 08012345678 --amount 100 --yes   # ONE real ₦100 airtime purchase to YOUR OWN number

Why this exists: their documentation and their own mobile app disagree on paths and field names, and the API has no sandbox. Steps 1 to 5
spend nothing. Step 6 spends ₦100 and ONLY runs when you pass --yes. Paste the output back so the integration can be confirmed or adjusted.
Never paste your API key.
"""
import argparse
import asyncio
import sys

from app.core.config import settings
from app.integrations.gyk import GykProvider, VtuError, get_vtu_provider

OK, FAIL, INFO = "[ OK ]", "[FAIL]", "[INFO]"


async def main(a) -> int:
    vtu: GykProvider = get_vtu_provider()
    bad = 0
    print(f"{INFO} Base URL {settings.GYK_BASE_URL}; airtime path {settings.GYK_AIRTIME_PATH}; data path {settings.GYK_DATA_PATH}; PIN configured: {bool(settings.GYK_TRANSACTION_PIN)}")
    if not vtu.configured:
        print(f"{FAIL} GYK_API_KEY is not set in this environment.")
        return 1

    bal = await vtu.wallet_balance()
    print(f"{OK if bal is not None else FAIL} 1. Key accepted and wallet readable: " + (f"balance ₦{bal:,.2f}" if bal is not None else "could not read the balance (key rejected, wrong base URL, or service down)"))
    bad += bal is None

    try:
        plans = await vtu.get_all_plans()
        by_net: dict[str, int] = {}
        for p in plans:
            by_net[p["network"]] = by_net.get(p["network"], 0) + 1
        print(f"{OK if plans else FAIL} 2. Plan list: {len(plans)} plans " + str({k: by_net[k] for k in sorted(by_net)}) + "  (1 MTN, 2 Glo, 3 9mobile, 4 Airtel)")
        for p in plans[:5]:
            print(f"        sample: network {p['network']} id {p['variation_code']}  {p['name']}  cost ₦{p['amount_naira']:,.0f}")
        bad += not plans
    except VtuError as e:
        print(f"{FAIL} 2. Plan list failed: {e.raw}")
        bad += 1

    try:
        fees = await vtu.get_fees()
        keys = {k: v for k, v in fees.items() if "air" in k.lower()}
        print(f"{OK if keys else INFO} 3. Fees / Airtime-to-Cash rates: {keys or 'none found'}")
    except VtuError as e:
        print(f"{FAIL} 3. Fees failed: {e.raw}")
        bad += 1

    from datetime import datetime, timedelta, timezone
    found = await vtu.find_purchase(phone="08000000000", since=datetime.now(timezone.utc) - timedelta(days=1))
    print(f"{OK if found is not None else FAIL} 4. Wallet history readable (used to settle unclear purchases): {'yes' if found is not None else 'NO: history call failed, so unclear purchases cannot be auto-settled'}")
    bad += found is None

    if a.buy_airtime:
        if not a.yes:
            print(f"{INFO} 5. Skipped the real purchase: add --yes to actually spend ₦{a.amount}.")
        else:
            net = a.network
            result = await vtu.buy_airtime(network=net, phone=a.buy_airtime, amount_naira=a.amount, idempotency_key="diagnose-test")
            print(f"{INFO} 5. Real ₦{a.amount} airtime purchase to {a.buy_airtime}: outcome {result['vendStatus']}, reference {result.get('transactionReference')}, message {result.get('responseMessage')!r}")
            if "_error" in result:
                e = result["_error"]
                print(f"        classified as: {'AMBIGUOUS (would be held)' if e.ambiguous else 'definite ' + e.kind + ' failure'}: {e.raw}")
                print("        If the message says the path/field is wrong, set GYK_AIRTIME_PATH=/api/airtime/ and re-run.")
            print("        CHECK THE PHONE: did the airtime arrive? Tell the developer the answer.")
    print("\n" + ("All read-only checks passed." if not bad else f"{bad} check(s) failed. Fix those before enabling VTU."))
    return 1 if bad else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--buy-airtime", help="your OWN phone number")
    ap.add_argument("--amount", type=int, default=100)
    ap.add_argument("--network", default="1", help="1 MTN, 2 Glo, 3 9mobile, 4 Airtel")
    ap.add_argument("--yes", action="store_true", help="really spend the money")
    sys.exit(asyncio.run(main(ap.parse_args())))
