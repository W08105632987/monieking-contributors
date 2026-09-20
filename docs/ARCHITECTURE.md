# Architecture

## The three surfaces, one backend

`apps/web`, `apps/admin`, and `backend` are three separate deployables. Both frontends talk to
the same FastAPI backend over `/api/v1/*`; neither talks to Supabase directly for anything except
two narrow exceptions in `apps/web`: Supabase Auth itself (login/session), and one Realtime
subscription on `withdrawals` (director's live withdrawal-claim updates). Everything else —
every read, every write, every business rule — goes through the backend, which holds its own
database credentials and never trusts a client-supplied role or permission claim.

## Why two frontends instead of one

`apps/web` is mobile-first and role-gated at the route level (customer/officer/director share one
SPA). `apps/admin` is a separate, desktop-only app for the `admin` role specifically — a CRM for
managing the whole platform (every customer, every officer, every zone, financial reconciliation,
system health). It was kept separate rather than added as a fourth role inside `apps/web` because
its UI needs (dense tables, a sidebar, no mobile chrome) and its security posture (mandatory 2FA
on every login, not just first device) are both genuinely different from the mobile app's.

## Auth

Two separate login flows:

- **`apps/web`** — Supabase Auth directly from the frontend (password grant), backend verifies
  the JWT on every request (`app/core/security.py::verify_supabase_jwt`).
- **`apps/admin`** — a two-step flow (`app/api/v1/routes/auth_admin.py`): password verified via
  the same Supabase mechanism, but the real session tokens are held server-side in Redis (keyed
  by a random `pending_id`) until a 6-digit SMS code is confirmed. The browser never sees the real
  session tokens until step 2 succeeds.

Backend role-gating uses FastAPI dependencies in `app/core/dependencies.py`: `CustomerOnly`,
`OfficerOnly`, `DirectorOnly`, `AdminOnly`, and combined ones (`DirectorOrAdmin`,
`CustomerOrOfficer`) used wherever director and admin should have equivalent authority — most CRM
endpoints reuse a `DirectorOnly` route by broadening it to `DirectorOrAdmin`, rather than
duplicating logic.

## Row-level security

Every table has RLS enabled, policies mirroring what the FastAPI layer already enforces. This
matters even though the backend doesn't rely on RLS for its own enforcement (it uses its own
credentials, bypassing RLS) — because `apps/web` holds a public Supabase anon key for Auth and
Realtime, and RLS is what stops that key from being used to read/write tables directly via
Supabase's REST API, bypassing the backend entirely. See `023_rls_coverage_gap.sql` for the audit
that found eight tables had never had RLS enabled at all.

## Money-moving code — the patterns that matter

- **Row locking**: every balance mutation (`wallet_service.py::credit_wallet`/`debit_wallet`,
  card contribution posting, withdrawal claim/approve) uses `SELECT ... FOR UPDATE`. The one bug
  ever found here (`wallet_service.py`, fixed) was SQLAlchemy's identity map returning a
  pre-lock cached object instead of the freshly-locked row's data — fixed with
  `execution_options(populate_existing=True)`. If you add a new locked read anywhere, that's the
  thing to check for.
- **Idempotency**: money-moving endpoints accept an `Idempotency-Key` header (frontend generates
  one automatically, see `apps/*/src/lib/api.ts`), checked via Redis
  (`app/core/idempotency.py`) — fails open if Redis is unreachable rather than blocking a real
  transaction.
- **Merchant references to external providers**: Monnify's `vendReference` uses the
  `BillPaymentRequest`'s own id — stable across retries, so a network timeout and retry can't
  double-vend.

## Notifications

Three channels, each for a different purpose:
- **In-app** (`Notification` model) — anything the user should see next time they open the app.
- **SMS** (`app/integrations/termii.py`) — OTPs, and the detailed contribution-confirmation SMS
  sent after every contribution (officer-marked or self-service).
- **Email** (`app/integrations/email_sender.py`) — system-health alerts only, not customer-facing.

## Background jobs

Celery, scheduled via `app/celery_app.py`'s `beat_schedule`:
- Deferred rate-change notification/application (`app/tasks/pricing.py`)
- System health monitor, every 3 minutes (`app/tasks/health_monitor.py`) — see
  `app/services/health_service.py` for what it checks and how alert de-duplication works.

## Analytics

Self-hosted, not a third-party script (`app/services/analytics_service.py`,
`apps/web/src/components/analytics/AnalyticsTracker.tsx`) — deliberate, since a fintech app's
click/pageview stream reveals who's active and when, which shouldn't leave your own
infrastructure by default. Feeds the "Live metrics" dashboards in both the admin CRM and the
director portal from one shared endpoint.

## What NOT to do

- Don't add a new endpoint that returns a raw ORM object through `response_model=UserResponse` —
  `zone_name` isn't a real column (it's a relationship), and this exact mistake caused a bug
  (blank zone badge until refresh) in four different places before `user_service.py`'s
  `build_user_response`/`build_user_responses` became the one shared way to build that response.
- Don't call Monnify or Termii without a timeout and a caught exception type your own code
  defines (`MonnifyBillsError`, not `fastapi.HTTPException`) — the latter only makes sense inside
  a live request and produces an unreadable crash from a background script or Celery task.
