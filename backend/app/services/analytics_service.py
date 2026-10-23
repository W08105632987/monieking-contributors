"""
Backs the live-metrics dashboard on both the admin CRM and the director
portal — same endpoints serve both, since they're asking for the same
platform-wide numbers, not two different views of them.
"""
import uuid
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import select, func, cast, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics_event import AnalyticsEvent
from app.models.user import User


async def track_event(
    db: AsyncSession, *, event_type: str, path: str, label: str | None,
    session_id: str, user_id: uuid.UUID | None, role: str | None, referrer: str | None,
) -> None:
    """Fire-and-forget by design — the route layer wraps this in a
    try/except that never lets a tracking failure surface to the person
    using the app (see analytics.py). A dropped pageview event is
    invisible to everyone except whoever's reading the dashboard later;
    a broken page because tracking failed would not be."""
    db.add(AnalyticsEvent(
        event_type=event_type, path=path[:2000], label=(label or None) and label[:500],
        session_id=session_id[:64], user_id=user_id, role=role, referrer=(referrer or None) and referrer[:500],
    ))
    await db.commit()


_LAGOS = timezone(timedelta(hours=1))   # Nigeria has no daylight saving


def _today_bounds() -> tuple[datetime, datetime]:
    """Midnight-to-midnight for 'today' in Nigerian time, as UTC instants."""
    now = datetime.now(_LAGOS)
    start = datetime.combine(now.date(), datetime.min.time(), tzinfo=_LAGOS)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


async def get_visitors(db: AsyncSession, *, today: bool, start_date: date | None, end_date: date | None, limit: int = 200) -> dict:
    """One row per visitor session: who they are when they are signed in, 'Not registered' when they are not."""
    filters = []
    if today:
        a, b = _today_bounds()
        filters += [AnalyticsEvent.created_at >= a, AnalyticsEvent.created_at < b]
    else:
        if start_date:
            filters.append(AnalyticsEvent.created_at >= datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc))
        if end_date:
            filters.append(AnalyticsEvent.created_at < datetime.combine(end_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1))
    rows = (await db.execute(
        select(
            AnalyticsEvent.session_id,
            func.max(cast(AnalyticsEvent.user_id, String)).label("user_id"),
            func.max(AnalyticsEvent.role).label("role"),
            func.count().label("events"),
            func.min(AnalyticsEvent.created_at).label("first_seen"),
            func.max(AnalyticsEvent.created_at).label("last_seen"),
        ).where(*filters).group_by(AnalyticsEvent.session_id).order_by(func.max(AnalyticsEvent.created_at).desc()).limit(limit)
    )).all()
    ids = {uuid.UUID(r.user_id) for r in rows if r.user_id}
    names = {}
    if ids:
        for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all():
            names[u.id] = (u.full_name, u.phone_number)
    out = []
    for r in rows:
        nm = names.get(uuid.UUID(r.user_id)) if r.user_id else None
        out.append({
            "session_id": r.session_id[:8], "registered": nm is not None,
            "name": nm[0] if nm else "Not registered", "phone_number": nm[1] if nm else None,
            "role": r.role or "visitor", "events": r.events,
            "first_seen": r.first_seen.isoformat(), "last_seen": r.last_seen.isoformat(),
        })
    return {"visitors": out, "registered": sum(1 for v in out if v["registered"]), "anonymous": sum(1 for v in out if not v["registered"])}


async def get_overview(db: AsyncSession, *, start_date: date | None, end_date: date | None, all_time: bool = False, today: bool = False) -> dict:
    """
    The dashboard's headline numbers plus a daily time series — the
    "Google Analytics inside the app" the product ask was for, scoped
    to what's actually meaningful for an internal tool: pageviews,
    unique visitors (by session, not by account — a logged-out landing
    page visit still counts), top pages, top clicks, and a role
    breakdown (how much of the traffic is customers vs officers vs
    directors vs the public).
    Defaults to rolling 30-day window when date range is omitted to avoid
    expensive unbounded scans on dashboard load (1.5).
    """
    if not all_time and not today and start_date is None and end_date is None:
        start_date = date.today() - timedelta(days=30)

    start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc) if start_date else None
    end_dt = (
        datetime.combine(end_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)
        if end_date else None
    )
    if today:
        start_dt, end_dt = _today_bounds()
        start_date = end_date = start_dt.astimezone(_LAGOS).date()
    filters = []
    if start_dt: filters.append(AnalyticsEvent.created_at >= start_dt)
    if end_dt:   filters.append(AnalyticsEvent.created_at < end_dt)

    pageview_filters = filters + [AnalyticsEvent.event_type == "pageview"]
    click_filters = filters + [AnalyticsEvent.event_type == "click"]

    totals = (await db.execute(
        select(
            select(func.count()).select_from(AnalyticsEvent).where(*pageview_filters).scalar_subquery().label("pageviews"),
            select(func.count(func.distinct(AnalyticsEvent.session_id))).where(*filters).scalar_subquery().label("unique_visitors"),
            select(func.count()).select_from(AnalyticsEvent).where(*click_filters).scalar_subquery().label("clicks"),
        )
    )).one()

    top_pages = (await db.execute(
        select(AnalyticsEvent.path, func.count().label("views"))
        .where(*pageview_filters)
        .group_by(AnalyticsEvent.path)
        .order_by(func.count().desc())
        .limit(10)
    )).all()

    top_clicks = (await db.execute(
        select(AnalyticsEvent.label, func.count().label("clicks"))
        .where(*click_filters, AnalyticsEvent.label.is_not(None))
        .group_by(AnalyticsEvent.label)
        .order_by(func.count().desc())
        .limit(10)
    )).all()

    by_role = (await db.execute(
        select(func.coalesce(AnalyticsEvent.role, "logged_out"), func.count(func.distinct(AnalyticsEvent.session_id)))
        .where(*filters)
        .group_by(AnalyticsEvent.role)
    )).all()

    # Daily time series — bucketed in Python rather than a DB-specific
    # date_trunc call, so this doesn't silently break if the underlying
    # Postgres version or timezone setting ever changes.
    raw_daily = (await db.execute(
        select(
            func.date(AnalyticsEvent.created_at).label("day"),
            AnalyticsEvent.event_type,
            func.count(),
        )
        .where(*filters)
        .group_by(func.date(AnalyticsEvent.created_at), AnalyticsEvent.event_type)
        .order_by(func.date(AnalyticsEvent.created_at))
    )).all()

    daily_map: dict[str, dict[str, int]] = {}
    for day, event_type, count in raw_daily:
        key = day.isoformat() if hasattr(day, "isoformat") else str(day)
        daily_map.setdefault(key, {"pageviews": 0, "clicks": 0})
        daily_map[key][f"{event_type}s"] = count

    return {
        "pageviews": totals.pageviews or 0,
        "unique_visitors": totals.unique_visitors or 0,
        "clicks": totals.clicks or 0,
        "top_pages": [{"path": p, "views": v} for p, v in top_pages],
        "top_clicks": [{"label": l, "clicks": c} for l, c in top_clicks],
        "by_role": [{"role": r, "visitors": v} for r, v in by_role],
        "daily": [{"date": k, **v} for k, v in sorted(daily_map.items())],
        "period": {"start_date": start_date.isoformat() if start_date else None, "end_date": end_date.isoformat() if end_date else None},
    }
