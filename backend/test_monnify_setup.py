"""
Standalone Monnify sandbox diagnostic script.

Run this from inside the backend/ folder, with your virtual environment
activated, so it can read the same .env and installed packages as the app:

    cd backend
    python test_monnify_setup.py

It does NOT touch your database or the rest of the app — it only talks
directly to Monnify, so you can see the real error instead of the silent
"non-fatal" failure the app was swallowing before.
"""
import asyncio
import base64
import uuid
import httpx

from app.core.config import settings


async def main():
    print("── Monnify config loaded from .env ──")
    print("Base URL:      ", settings.MONNIFY_BASE_URL)
    print("API Key:       ", (settings.MONNIFY_API_KEY[:6] + "...") if settings.MONNIFY_API_KEY else "(missing)")
    print("Secret Key:    ", "set" if settings.MONNIFY_SECRET_KEY else "(missing)")
    print("Contract Code: ", settings.MONNIFY_CONTRACT_CODE or "(missing)")
    print()

    if not settings.MONNIFY_API_KEY or not settings.MONNIFY_SECRET_KEY or not settings.MONNIFY_CONTRACT_CODE:
        print("❌ One or more Monnify env vars are missing. Fix backend/.env first.")
        return

    credentials = base64.b64encode(
        f"{settings.MONNIFY_API_KEY}:{settings.MONNIFY_SECRET_KEY}".encode()
    ).decode()

    async with httpx.AsyncClient() as client:
        print("── Step 1: authenticating ──")
        resp = await client.post(
            f"{settings.MONNIFY_BASE_URL}/api/v1/auth/login",
            headers={"Authorization": f"Basic {credentials}"},
        )
        print("Status:", resp.status_code)
        print("Body:  ", resp.text)
        if resp.status_code != 200:
            print("\n❌ Auth failed. Double-check MONNIFY_API_KEY / MONNIFY_SECRET_KEY against")
            print("   what's shown on your Monnify sandbox dashboard (Settings > API Keys).")
            return
        token = resp.json()["responseBody"]["accessToken"]
        print("✅ Auth succeeded\n")

        print("── Step 2: creating a test reserved account ──")
        ref = f"MK-TEST-{uuid.uuid4().hex[:8].upper()}"
        payload = {
            "accountReference":     ref,
            "accountName":          "Test Account",
            "currencyCode":         "NGN",
            "contractCode":         settings.MONNIFY_CONTRACT_CODE,
            "customerEmail":        "test@monieking.app",
            "customerName":         "Test Account",
            "getAllAvailableBanks": False,
            "preferredBanks":       ["035"],
        }
        resp = await client.post(
            f"{settings.MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts",
            json=payload,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=30,
        )
        print("Status:", resp.status_code)
        print("Body:  ", resp.text)
        if resp.status_code not in (200, 201):
            print("\n❌ Reserved account creation failed. Common causes:")
            print("   - MONNIFY_CONTRACT_CODE doesn't match your sandbox contract")
            print("   - Reserved Accounts isn't enabled on this contract yet")
            print("   - Wema Bank ALAT (bank code 035) isn't enabled as a preferred bank on this contract")
            return

        body = resp.json()["responseBody"]
        accounts = body.get("accounts", [])
        print("\n✅ Reserved account created successfully")
        for acc in accounts:
            print(f"   {acc['bankName']}: {acc['accountNumber']}")
        print("\nNext step: open the Monnify sandbox Payment Simulator, paste one of the")
        print("account numbers above, enter a test amount, and submit — that simulates a")
        print("real bank transfer into it.")


if __name__ == "__main__":
    asyncio.run(main())