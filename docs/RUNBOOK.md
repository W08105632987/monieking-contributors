# Runbook — day-2 operations

## Running migrations

Every file in `supabase/migrations/`, in numeric order, via the Supabase SQL editor or `psql`.
There's no migration-tracking table — you're responsible for knowing which have run. If a
`CREATE TABLE` errors with "already exists", **stop and check what actually exists** before
continuing — see `025_bill_payments_schema_reconciliation.sql`'s own comments for a real example
of what happened when a table existed from something other than its own migration.

## Clearing test data before go-live

```bash
cd backend
python -m scripts.clear_test_customers                 # dry run — prints counts, changes nothing
python -m scripts.clear_test_customers --execute        # actually deletes
python -m scripts.clear_test_customers --execute --keep 08011112222   # preserve specific numbers
```

Customer-role only by default. Deletes dependents (cards, contributions, withdrawals, wallet,
notifications, disputes, audit-log-as-actor rows) in FK-safe order first, then the user row.

## Populating the biller catalog

The `billers` table starts empty — nothing in the app populates it automatically.

```bash
cd backend
python -m scripts.sync_billers
```

Safe to re-run any time (upserts, never duplicates). Run it on a schedule (daily is enough) once
you've confirmed it works against your live Monnify credentials — the discovery endpoint's exact
field names were confirmed against Monnify's public docs and a working third-party integration's
code, not against a live response of your own, so watch the first run's output closely.

## System health monitor

Runs automatically every 3 minutes via Celery beat, once a worker + beat process are running:

```bash
cd backend
celery -A app.celery_app worker --loglevel=info
celery -A app.celery_app beat --loglevel=info
```

To get alerts, set in `.env`: `ALERT_EMAIL_TO`, `ALERT_PHONE_TO`, and real SMTP credentials
(`SMTP_HOST`/`SMTP_USERNAME`/`SMTP_PASSWORD`). Nothing fires without these set.

To test the whole pipeline without waiting 3 minutes: open the admin CRM's **System health**
page and click **Run checks now**, or `POST /api/v1/system-health/run-now` directly.

## Rotating the admin 2FA / login lockout state

Nothing to rotate manually — lockout state lives on the `users` table
(`login_locked_until`), 2FA OTPs auto-expire after 5 minutes
(`two_factor_otp_expires_at`). If an admin is stuck locked out, use the CRM's own
**Force password reset** (Customer 360 / Officer detail pages) or clear
`login_locked_until` directly in the database.

## Environment variables reference

See `backend/.env.example` — every variable is commented with what it's for and, where relevant,
what happens if it's left blank (most external integrations fail open/inert rather than crashing
the app when unconfigured).
