"""
Celery app for MonieKing's scheduled jobs — first real use of the
celery/redis dependencies that were already in requirements.txt but never
wired up. Currently powers the deferred Food Card pricing mechanic:
  - Dec 31, every year: notify all customers of tomorrow's rate change
  - Jan 1, every year: apply the scheduled rate change

Run alongside the API in deployment:
  celery -A app.celery_app worker --loglevel=info
  celery -A app.celery_app beat --loglevel=info
"""
from celery import Celery
from celery.schedules import crontab
from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "monieking",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.pricing", "app.tasks.health_monitor"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

celery_app.conf.beat_schedule = {
    "notify-pending-rate-changes-dec-31": {
        "task": "app.tasks.pricing.notify_pending_rate_changes",
        # 06:00 UTC on Dec 31 — gives the notification a full day of visibility
        # before the change takes effect at midnight
        "schedule": crontab(hour=6, minute=0, day_of_month=31, month_of_year=12),
    },
    "apply-pending-rate-changes-jan-1": {
        "task": "app.tasks.pricing.apply_pending_rate_changes",
        # 00:05 UTC on Jan 1 — just after midnight
        "schedule": crontab(hour=0, minute=5, day_of_month=1, month_of_year=1),
    },
    "system-health-check": {
        "task": "app.tasks.health_monitor.run_health_checks",
        # Every 3 minutes — frequent enough to catch an outage quickly
        # without hammering the database/external providers with
        # constant reachability pings. Alert cooldown (see
        # HEALTH_CHECK_ALERT_COOLDOWN_MINUTES) is what actually stops
        # this from re-sending SMS every 3 minutes during an ongoing
        # incident, not the schedule interval itself.
        "schedule": crontab(minute="*/3"),
    },
}
