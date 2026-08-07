# MonieKing Contributors

> Production-grade Contribution Management Platform

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + TailwindCSS + Vite |
| Backend | Python FastAPI + SQLAlchemy (async) |
| Auth | Supabase Auth (JWT) |
| Database | PostgreSQL via Supabase |
| Storage | Supabase Storage |
| Payments | Monnify Reserved Accounts (provider-agnostic adapter) |
| Biometrics | WebAuthn / Passkeys (device-native) |
| State | Zustand + TanStack Query |
| Animations | Framer Motion |

## Quick Start

### 1. Clone and install

```bash
# Install frontend
cd apps/web
npm install

# Install backend
cd ../../backend
pip install -r requirements.txt --break-system-packages
```

### 2. Environment variables

```bash
# Frontend
cp apps/web/.env.example apps/web/.env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# Backend
cp backend/.env.example backend/.env
# Fill in DATABASE_URL, SUPABASE credentials, MONNIFY keys
```

### 3. Database setup

Run migrations in order in your Supabase SQL editor:
```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_row_level_security.sql
supabase/seed/001_seed_data.sql  (development only)
```

### 4. Run development servers

```bash
# Frontend (port 3000)
cd apps/web && npm run dev

# Backend (port 8000)
cd backend && uvicorn app.main:app --reload --port 8000
```

### 5. Access

- Frontend: http://localhost:3000
- API docs: http://localhost:8000/docs
- Health check: http://localhost:8000/health

## Project Structure

```
monieking-contributors/
├── apps/
│   └── web/                    # React + TypeScript frontend
│       └── src/
│           ├── components/     # Reusable UI components
│           │   ├── ui/         # Button, Input, Badge, Modal, Skeleton
│           │   ├── layout/     # AppShell, TopBar, BottomNav (liquid blob)
│           │   └── cards/      # Flippable ContributionCard
│           ├── features/       # Feature modules
│           ├── hooks/          # useAuth, useWallet, useCards
│           ├── lib/            # supabase.ts, api.ts, utils.ts, webauthn.ts
│           ├── pages/          # customer/, officer/, admin/, director/, auth/
│           ├── store/          # Zustand stores (auth, wallet, notifications)
│           └── types/          # TypeScript interfaces
├── backend/                    # FastAPI Python backend
│   └── app/
│       ├── api/v1/routes/      # auth, users, wallets, cards, withdrawals, notifications, admin, webhooks
│       ├── core/               # config, database, security, dependencies
│       ├── integrations/       # Monnify adapter + BasePaymentProvider interface
│       ├── models/             # SQLAlchemy ORM models
│       ├── schemas/            # Pydantic request/response schemas
│       ├── services/           # wallet_service, card_service, notification_service
│       └── utils/              # audit logger, kobo converter
├── supabase/
│   ├── migrations/             # 001_initial_schema.sql, 002_row_level_security.sql
│   └── seed/                   # 001_seed_data.sql
└── docs/                       # Architecture docs, SRS
```

## Key Business Rules (enforced server-side)

- Contribution amount **must be a multiple of card rate** — rejected otherwise
- Food Card funds are **locked** — conversion prompt shown before any withdrawal
- Withdrawal charge = **one day's rate** deducted per request
- Officer wallet must have **sufficient balance** before posting customer contribution
- Completed cards are **archived with status flags** (Paid / Unpaid / Withdrawal Pending)
- Withdrawal claim uses **optimistic locking** — only one Director can claim
- All Monnify webhooks are **idempotent** — duplicate references silently ignored
- All monetary values stored as **BIGINT in kobo** — zero floating-point errors
- Audit log is **append-only** — UPDATE and DELETE revoked at DB level

## Design System

- **Primary colour**: Forest Green `#052E16` → `#34D399`
- **Accent colour**: Copper Gold `#F59E0B` → `#D97706`
- **Font**: Plus Jakarta Sans (Google Fonts)
- **Mobile Nav**: Liquid blob bottom navigation (Framer Motion)
- **Contribution Card**: Flippable card — front (branding) / back (12×31 grid)
