"""Production check: can we create a Monnify virtual account, and if not, why?

Run it where the production env vars exist, e.g.
    railway run python scripts/diagnose_monnify_va.py
It prints every step in plain words. It never prints your secret key.
It creates ONE throw-away reserved account (reference DIAG-<random>) only if
login succeeds; that is harmless and can be ignored.
"""
import asyncio, base64, os, sys, uuid
import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.config import settings  # noqa: E402


def mask(v: str) -> str:
    return "(EMPTY!)" if not v else f"{v[:4]}…{v[-3:]} (len {len(v)})"


async def main() -> None:
    base = (settings.MONNIFY_BASE_URL or "").rstrip("/")
    print("1) Settings")
    print("   base url     :", base or "(EMPTY!)")
    print("   api key      :", mask(settings.MONNIFY_API_KEY))
    print("   secret key   :", "set (len %d)" % len(settings.MONNIFY_SECRET_KEY or ""))
    print("   contract code:", mask(settings.MONNIFY_CONTRACT_CODE))
    if "sandbox" in base.lower():
        print("   NOTE: this is the SANDBOX url. Live keys will be rejected here.")
    for name, val in (("api key", settings.MONNIFY_API_KEY), ("secret", settings.MONNIFY_SECRET_KEY), ("contract", settings.MONNIFY_CONTRACT_CODE)):
        if val and val != val.strip():
            print(f"   WARNING: the {name} has a leading/trailing space or newline. Re-paste it.")

    async with httpx.AsyncClient(timeout=30) as c:
        print("\n2) Login")
        cred = base64.b64encode(f"{settings.MONNIFY_API_KEY}:{settings.MONNIFY_SECRET_KEY}".encode()).decode()
        try:
            r = await c.post(f"{base}/api/v1/auth/login", headers={"Authorization": f"Basic {cred}"})
        except Exception as e:
            print("   COULD NOT REACH MONNIFY:", repr(e)); return
        print("   HTTP", r.status_code, "|", r.text[:300])
        if r.status_code != 200:
            print("   => Login failed. Wrong/mixed-up keys, or sandbox keys on the live url (or the reverse).")
            return
        token = r.json()["responseBody"]["accessToken"]

        print("\n3) Create a reserved account (test)")
        ref = "DIAG-" + uuid.uuid4().hex[:10].upper()
        payload = {
            "accountReference": ref, "accountName": "MonieKing Diagnostic", "currencyCode": "NGN",
            "contractCode": settings.MONNIFY_CONTRACT_CODE, "customerEmail": f"{ref.lower()}@monieking.app",
            "customerName": "MonieKing Diagnostic", "getAllAvailableBanks": False, "preferredBanks": ["035"],
        }
        r = await c.post(f"{base}/api/v2/bank-transfer/reserved-accounts", json=payload, headers={"Authorization": f"Bearer {token}"})
        print("   HTTP", r.status_code, "|", r.text[:600])
        if r.status_code in (200, 201) and r.json().get("requestSuccessful"):
            acc = (r.json()["responseBody"].get("accounts") or [{}])[0]
            print("   => WORKS. Got account", acc.get("accountNumber"), acc.get("bankName"))
            print("   So Monnify is fine; the problem is elsewhere (send me the app log line).")
        else:
            print("   => Monnify refused. The message above is the exact reason.")
            print("      'contract'/'not found'  -> wrong contract code or wrong environment")
            print("      'not enabled'/'permission' -> ask Monnify to enable Reserved Accounts (Wema 035)")
            print("      'BVN'/'NIN'             -> your account requires BVN/NIN at creation; tell me")

asyncio.run(main())
