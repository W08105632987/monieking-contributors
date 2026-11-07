"""Ask Monnify, right now, whether the electricity token for ONE bill payment exists yet.
Run on the SAME environment the API runs on (Railway shell), from the backend folder:
    python -m scripts.check_bill_token <REQUEST_ID>            # read-only: prints what Monnify says
    python -m scripts.check_bill_token <REQUEST_ID> --save     # same, and if a token is there, store it on the request
It never vends, never refunds and never touches the wallet. `--save` writes ONLY the token (and units) onto a COMPLETED
request that has none, using the app's own backfill. The token is masked on screen except with --show.
"""
import argparse
import asyncio
import json
import os
import sys
import uuid

if "DATABASE_URL" in os.environ and ":5432" in os.environ["DATABASE_URL"]:
    os.environ["DATABASE_URL"] = os.environ["DATABASE_URL"].replace(":5432", ":6543")

from app.core.database import AsyncSessionLocal
from app.integrations.monnify_bills import MonnifyBillsError, get_bills_provider, vend_outcome
from app.models.bill_payment import BillPaymentRequest
from app.services import bill_payment_service as svc
def mask(v: str, show: bool) -> str:
    v = str(v)
    return v if show else ("*" * max(0, len(v) - 4)) + v[-4:]
def walk(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, f"{path}.{k}" if path else k)
    else:
        yield path, node
async def main(request_id: uuid.UUID, save: bool, show: bool) -> int:
    async with AsyncSessionLocal() as db:
        req = await db.get(BillPaymentRequest, request_id)
        if not req:
            print("No such bill payment request.")
            return 1
        print(f"Request {req.id}: status={req.status.value} amount=N{req.amount_kobo/100:,.2f} "
              f"token stored={'yes' if req.token else 'NO'} monnify_ref={req.monnify_transaction_reference}")
        provider = get_bills_provider()
        result = None
        for ref in svc._vend_references(req):
            try:
                result = await provider.requery_bill(ref)
                print(f"Requery by {ref}: answered")
                break
            except MonnifyBillsError as e:
                print(f"Requery by {ref}: {e.raw}")
        if result is None:
            print("\nMonnify did not answer for any reference. Try again in a few minutes.")
            return 2
        print(f"\nvendStatus (our reading): {vend_outcome(result)}")
        token = svc._extract_token(result)
        for path, value in walk(result):
            if any(w in path.lower() for w in ("token", "pin", "unit", "status", "message")):
                shown = mask(value, show) if "token" in path.lower() and value else value
                print(f"  {path} = {shown!r}")
        if not token:
            print("\nNO TOKEN YET: Monnify's own record still has none. Nothing on our side can create it.")
            print("The background job re-checks every 2 minutes. If it is still empty after a long wait, only the provider (AEDC) / Monnify can issue it.")
            return 3
        print(f"\nTOKEN FOUND: {mask(token, show)}  units={svc._read_units(result)}")
        if save:
            if req.token:
                print("Request already has a token; nothing saved.")
            else:
                req2 = await svc.backfill_missing_token(db, req)
                print("Saved to the request." if req2.token else "Could not save (request not COMPLETED or not electricity).")
        else:
            print("Not saved (run again with --save to store it on the request).")
        return 0
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("request_id", type=uuid.UUID)
    ap.add_argument("--save", action="store_true")
    ap.add_argument("--show", action="store_true", help="print the full token instead of masking it")
    a = ap.parse_args()
    sys.exit(asyncio.run(main(a.request_id, a.save, a.show)))
