"""Production check: can we create a Monnify virtual account WITH a NIN, and which variant works?

    railway run python -u scripts\\diagnose_monnify_va.py <YOUR_11_DIGIT_NIN> "<NAME AS ON NIN>"

Tries the same creation several ways and prints Monnify's exact reply for each, so we can see whether it is the
bank (Wema 035), the name, or the account that is being refused. Creates real reserved accounts only if one works
(references DIAG-xxxx, in YOUR name). Never prints the secret key.
"""
import asyncio, base64, os, sys, uuid
import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.config import settings  # noqa: E402


async def main() -> None:
    nin = sys.argv[1] if len(sys.argv) > 1 else ""
    name = sys.argv[2] if len(sys.argv) > 2 else "MonieKing Diagnostic"
    base = (settings.MONNIFY_BASE_URL or "").rstrip("/")
    print("base url:", base, "| contract:", (settings.MONNIFY_CONTRACT_CODE or "")[:4] + "…", "| NIN given:", bool(nin), "| name:", name)
    async with httpx.AsyncClient(timeout=40) as c:
        cred = base64.b64encode(f"{settings.MONNIFY_API_KEY}:{settings.MONNIFY_SECRET_KEY}".encode()).decode()
        r = await c.post(f"{base}/api/v1/auth/login", headers={"Authorization": f"Basic {cred}"})
        print("login:", r.status_code)
        if r.status_code != 200:
            print(r.text[:300]); return
        h = {"Authorization": "Bearer " + r.json()["responseBody"]["accessToken"]}

        def body(**extra):
            ref = "DIAG-" + uuid.uuid4().hex[:10].upper()
            b = {"accountReference": ref, "accountName": name, "currencyCode": "NGN", "contractCode": settings.MONNIFY_CONTRACT_CODE,
                 "customerEmail": f"{ref.lower()}@monieking.app", "customerName": name}
            b.update(extra)
            return b

        variants = [
            ("A) NIN + Wema 035 (what the app does now)", body(nin=nin, getAllAvailableBanks=False, preferredBanks=["035"])),
            ("B) NIN + any available bank", body(nin=nin, getAllAvailableBanks=True)),
            ("C) NIN, no bank preference", body(nin=nin)),
            ("D) NO NIN, Wema 035 (control)", body(getAllAvailableBanks=False, preferredBanks=["035"])),
        ]
        if not nin:
            print("No NIN given: only the control will be meaningful."); variants = variants[3:]
        for label, payload in variants:
            r = await c.post(f"{base}/api/v2/bank-transfer/reserved-accounts", json=payload, headers=h)
            print(f"\n{label}\n   HTTP {r.status_code} | {r.text[:400]}")
            if r.status_code in (200, 201):
                accs = (r.json().get("responseBody") or {}).get("accounts") or []
                print("   => WORKS:", [(a.get("bankName"), a.get("accountNumber")) for a in accs])

asyncio.run(main())
