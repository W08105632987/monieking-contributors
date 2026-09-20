# MonieKing

A digital contribution-savings platform for Nigeria — a modern take on the traditional ajo/esusu
thrift-collection model. Customers contribute daily to a contribution card, either digitally or
in cash through a zone officer; funds live in a Monnify-backed wallet with virtual accounts,
airtime/data/bill payments, and a full audit trail behind every transaction.

This repo contains three deployable surfaces sharing one FastAPI backend:

| Surface | Path | Who it's for | Port (dev) |
|---|---|---|---|
| Mobile/web app | `apps/web` | Customers, officers, directors | 3000 |
| Admin CRM | `apps/admin` | Admin-role staff only, desktop-only | 3001 |
| Backend API | `backend` | Serves both frontends | 8000 |

See `docs/ARCHITECTURE.md` for how the pieces fit together, `docs/ADMIN_CRM_CHECKLIST.md` for the
CRM's build status against its full planned scope, and `docs/RUNBOOK.md` for day-2 operations
(migrations, the test-data cleanup script, the health monitor, etc.).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend (both apps) | React 18 + TypeScript + TailwindCSS + Vite |
| Backend | Python FastAPI + SQLAlchemy (async) + asyncpg |
| Auth | Supabase Auth (JWT) — plus a separate SMS-OTP second factor for the admin CRM |
| Database | PostgreSQL via Supabase, with row-level security on every table |
| Cache / queues | Redis + Celery (rate limiting, idempotency guards, scheduled jobs) |
| Payments | Monnify (Reserved Accounts, Disbursements, Bills Payment) |
| SMS | Termii |
| Email | Plain SMTP (any provider) — system-health alerts only |
| Identity verification | Youverify (BVN/NIN) |
| Error monitoring | Sentry (optional, gated on `SENTRY_DSN`) |
| Charts | Recharts |
| Animation | Framer Motion |
| State | Zustand + TanStack Query |

## Quick start

You need Postgres (via Supabase), Redis, and Python 3.11+ / Node 18+ locally.

```bash
# From the repo root — installs both apps/web and apps/admin in one pass
npm install

# Backend
cd backend
python -m venv venv && venv\Scripts\activate   # or source venv/bin/activate on macOS/Linux
pip install -r requirements.txt --break-system-packages
cp .env.example .env   # fill in your Supabase/Monnify/Termii/etc. credentials
```

### Database

Every migration lives in `supabase/migrations/`, numbered and run in order. Run every one of
them, in order, against your database — via the Supabase SQL editor or `psql`. There are 28 as of
this writing (`001_initial_schema.sql` through `028_legal_acceptance.sql`); see
`docs/RUNBOOK.md` for what to do if a migration errors with "already exists" partway through.

### Running everything

Three processes, three terminals, all from the repo root:

```bash
npm run dev:backend    # FastAPI on :8000
npm run dev:web        # customer/officer/director app on :3000
npm run dev:admin      # admin CRM on :3001
```

For the Celery-scheduled jobs (deferred rate changes, the system health monitor) to actually run,
you also need a Celery worker and beat process — see `docs/RUNBOOK.md`.

## Repo layout

```
apps/
  web/            customer, officer, and director portals (one SPA, role-gated routes)
  admin/          the admin CRM — separate app, admin-role only, 2FA login
backend/
  app/
    api/v1/routes/    one file per feature area — see docs/ARCHITECTURE.md for the map
    services/         business logic, called by routes
    models/           SQLAlchemy models
    integrations/     external providers (Monnify, Termii, Youverify, email)
    tasks/            Celery jobs
  scripts/            one-off/maintenance scripts (test-data cleanup, biller sync, etc.)
supabase/migrations/  every schema change, numbered, run in order
docs/                 architecture, runbook, CRM checklist
```

## Key features by role

- **Customer** — contribution cards (food/regular), wallet, airtime/data/bill payments, identity
  services, disputes, withdrawal requests, biometric (WebAuthn) login.
- **Officer** — mark contributions for customers in their zone, customer statistics with an
  inactive-customer list and tap-to-call, per-officer contribution totals.
- **Director** — everything an officer has platform-wide, plus zone/officer management, business
  settings, broadcasts, live metrics, and system health — all from a mobile portal.
- **Admin** (desktop-only CRM) — everything a director has, plus director management, financial
  reconciliation, force password reset, and full platform-wide customer search — gated behind
  mandatory SMS 2FA on every login.

## Where to read more

- `docs/ARCHITECTURE.md` — how requests flow, why certain things are built the way they are
  (RLS, the admin CRM's separate 2FA flow, the health monitor's alert cooldown logic)
- `docs/RUNBOOK.md` — day-2 operations: running migrations, clearing test data, the health
  monitor, biller sync
- `docs/ADMIN_CRM_CHECKLIST.md` — the CRM's full planned scope vs. what's actually built
- `apps/web/src/pages/legal/` — Terms of Service and Privacy Policy (drafts — need legal review
  before relying on them, see the notice at the top of each)
