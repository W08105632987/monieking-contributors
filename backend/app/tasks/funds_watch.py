"""Scheduled work for the company-funds page: close the day at the director's chosen time, and watch Monnify settlement."""
import asyncio

from app.celery_app import celery_app
from app.core.database import AsyncSessionLocal


async def _auto_close() -> dict:
    from app.services.company_funds_service import auto_close_due
    async with AsyncSessionLocal() as db:
        res = await auto_close_due(db)
        await db.commit()
    if res.get("closed") and abs(res.get("difference_kobo", 0)) >= 100:
        from app.services.alert_service import raise_alert
        d = res["difference_kobo"]
        await raise_alert(severity="warning", category="fraud", title=f"Daily books closed with ₦{abs(d)/100:,.2f} {'missing' if d < 0 else 'extra'}",
                          detail={"day": res["closed"], "difference_kobo": d}, dedupe_key=f"day-close-diff:{res['closed']}")
    return res


async def _watch_settlement() -> dict:
    from app.services import monnify_center_service as mc
    from app.services import settings_service as cfg
    from app.services.alert_service import raise_alert, resolve_alert
    async with AsyncSessionLocal() as db:
        if (await cfg.get_config_value(db, mc.LATE_ALERT_KEY, "true")) == "false":
            return {"enabled": False}
        pos = await mc.settlement_position(db)
    if pos["late_count"]:
        await raise_alert(severity="warning", category="provider",
                          title=f"{pos['late_count']} Monnify payment(s) worth ₦{pos['late_kobo']/100:,.2f} are past their settlement day",
                          detail={"late": pos["late_items"][:10], "settlement_days": pos["settlement_days"]}, dedupe_key="monnify-late-settlement")
    else:
        await resolve_alert("monnify-late-settlement", note="all payments are settled or within their settlement day")
    return {"late": pos["late_count"]}


@celery_app.task(name="app.tasks.funds_watch.auto_close_day")
def auto_close_day():
    return asyncio.run(_auto_close())


@celery_app.task(name="app.tasks.funds_watch.watch_settlement")
def watch_settlement():
    return asyncio.run(_watch_settlement())
