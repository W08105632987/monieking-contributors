"""Go-live checklist for Monnify. Never returns a secret — only whether each
piece is present and whether live calls actually work."""
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.integrations.monnify import MonnifyProvider
from app.models.bill_payment import Biller

SANDBOX_SOURCE_ACCOUNT = "5856364342"


def _item(key: str, label: str, status: str, detail: str) -> dict:
    return {"key": key, "label": label, "status": status, "detail": detail}


def static_checks() -> list[dict]:
    live = "sandbox" not in settings.MONNIFY_BASE_URL.lower()
    out = [
        _item("mode", "Environment", "ok" if live else "warn",
              "LIVE (api.monnify.com)" if live else
              "SANDBOX — set MONNIFY_BASE_URL=https://api.monnify.com for real money. In sandbox, webhook signatures are NOT enforced."),
        _item("api_key", "API key", "ok" if settings.MONNIFY_API_KEY else "fail", "Set" if settings.MONNIFY_API_KEY else "MONNIFY_API_KEY is empty"),
        _item("secret_key", "Secret key", "ok" if settings.MONNIFY_SECRET_KEY else "fail", "Set" if settings.MONNIFY_SECRET_KEY else "MONNIFY_SECRET_KEY is empty"),
        _item("contract_code", "Contract code", "ok" if settings.MONNIFY_CONTRACT_CODE else "fail",
              "Set" if settings.MONNIFY_CONTRACT_CODE else "MONNIFY_CONTRACT_CODE is empty (needed to create virtual accounts)"),
    ]
    if settings.MONNIFY_WEBHOOK_SECRET and settings.MONNIFY_SECRET_KEY and settings.MONNIFY_WEBHOOK_SECRET != settings.MONNIFY_SECRET_KEY:
        out.append(_item("webhook_secret", "Webhook signing key", "warn",
                         "MONNIFY_WEBHOOK_SECRET differs from MONNIFY_SECRET_KEY. Monnify signs with your secret key, so leave it blank or make them equal, otherwise live payments will be rejected."))
    else:
        out.append(_item("webhook_secret", "Webhook signing key", "ok", "Signatures are verified with your Monnify secret key"))
    src = settings.MONNIFY_SOURCE_ACCOUNT_NUMBER
    if live and (not src or src == SANDBOX_SOURCE_ACCOUNT):
        out.append(_item("source_account", "Payout source account", "fail",
                         "MONNIFY_SOURCE_ACCOUNT_NUMBER is still the sandbox wallet. Set your live Monnify wallet account number or withdrawals will fail."))
    else:
        out.append(_item("source_account", "Payout source account", "ok" if src else "fail", "Set" if src else "MONNIFY_SOURCE_ACCOUNT_NUMBER is empty"))
    return out


async def run_checks(db: AsyncSession) -> dict:
    checks = static_checks()
    provider = MonnifyProvider()
    # Live calls — each isolated so one failure doesn't hide the rest.
    try:
        await provider._headers()
        checks.append(_item("auth", "Login to Monnify", "ok", "Credentials accepted"))
        try:
            banks = await provider.get_banks()
            checks.append(_item("banks", "Bank list / account lookup", "ok" if banks else "warn", f"{len(banks)} banks loaded"))
        except Exception as e:  # noqa: BLE001
            checks.append(_item("banks", "Bank list / account lookup", "fail", str(getattr(e, "detail", e))[:200]))
    except Exception as e:  # noqa: BLE001
        checks.append(_item("auth", "Login to Monnify", "fail", str(getattr(e, "detail", e))[:200]))

    n = (await db.execute(select(func.count()).select_from(Biller))).scalar() or 0
    checks.append(_item("billers", "Bills catalogue (airtime, data, electricity, cable)", "ok" if n else "warn",
                        f"{n} products synced" if n else "Empty — run scripts/sync_billers.py once after going live so customers see plans"))
    checks.append(_item("whitelist", "Server IP whitelisting", "warn",
                        "Monnify live needs your server's outbound IP whitelisted for transfers and bills. Confirm it in Monnify dashboard → Settings → API."))
    checks.append(_item("webhook_url", "Webhook URL", "warn",
                        "In Monnify dashboard set the transaction-completion webhook to https://<your-api-domain>/api/v1/webhooks/monnify/payment"))
    order = {"fail": 0, "warn": 1, "ok": 2}
    overall = min((order[c["status"]] for c in checks), default=2)
    return {"ready": overall == 2, "has_failures": overall == 0, "checks": checks}
