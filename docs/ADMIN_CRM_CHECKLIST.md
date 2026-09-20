# MonieKing Admin CRM — build checklist

How to read this: `[x]` means it's in the delivered code, right now, in
this repo. `[ ]` means it isn't built yet. This file gets updated every
time a module ships — check it against the actual code, not against
what a conversation summary claims.

Scope, access model, and phase-1 module choice were locked in during
planning: **admin role only** (directors keep their existing mobile
portal, untouched), **2FA on every login** (not just first device),
starting with **Overview + Customer 360**.

**A note on access control, since phases 2–5 needed it:** several
backend endpoints this CRM depends on (create officer/director,
suspend/reactivate/delete a user, zone create/delete/assign, officer
contribution stats) were `DirectorOnly` before this batch — meaning
admin genuinely couldn't do the things this CRM exists for. Each was
individually broadened to `DirectorOrAdmin`, the same dependency
already used elsewhere in the backend (disputes, withdrawals,
notifications) for exactly this "director and admin are equivalent
authority" pattern. Nothing was broadened further than that — customer/
officer-facing endpoints stay exactly as scoped as before.

**A note on the mobile app's Customer Statistics panel:** separately
from the CRM phases, the shared `CustomerStatsPanel` component (used
on the director's mobile dashboard, director → officer detail, and the
officer's own dashboard/detail page) now defaults to **All time**
instead of Today, with a compact dropdown — same visual style as the
director dashboard's hero-card period picker — to narrow to Today / 7
days / Custom range. This was a direct request, not part of the phase
plan above, and touches `apps/web`, not `apps/admin`.

---

## Phase 0 — Foundation

- [x] `apps/admin` workspace scaffolded (Vite + React + TS + Tailwind), added to root `package.json` workspaces
- [x] Desktop-only layout shell (sidebar nav, no mobile chrome, no bottom nav, no PWA manifest)
- [x] Same brand palette/fonts as `apps/web`, so it visually reads as the same product
- [x] `POST /auth/admin/login` — phone + password, admin-role-gated, reuses existing lockout logic
- [x] SMS OTP second factor — `POST /auth/admin/verify-otp`, real session tokens held server-side in Redis until the code is confirmed, single-use, 5-minute expiry, 5-attempt cap
- [x] Migration `022_admin_two_factor.sql` (separate OTP columns from the password-reset OTP pair, so the two flows can't collide)
- [x] `AuthGuard` — validates the live session against `/users/me` on every load, redirects to `/login` if not an authenticated admin
- [ ] Deployed to its own subdomain (e.g. `admin.monieking.webodemos.com`) — infra/DNS step, not a code step; not done yet
- [ ] Production build actually run (`npm run build` in `apps/admin`) and smoke-tested — the code compiles by inspection and follows `apps/web`'s exact patterns, but hasn't been run in a real Node environment yet (this sandbox has no `node_modules` installed)

## Phase 1 — Overview + Customer 360 *(current phase)*

- [x] Overview dashboard — platform KPIs (total/food/regular/active/inactive/new contributors, total value active), reusing the existing `/customer-stats/overview` endpoint, no new backend needed
- [x] Customer search/list — `GET /admin/crm/customers`, search by name/phone/customer number, paginated
- [x] Customer 360 detail — `GET /admin/crm/customers/{id}/full-profile`: profile (incl. zone name, KYC/BVN/NIN status), wallet + virtual account, every card with full withdrawal history, disputes raised
- [ ] Customer actions from this page — suspend/reactivate, manual notes. Force password reset shipped (see below); suspend/notes still deferred
- [x] Force password reset — `CustomerDetailPage.tsx`, same mechanism as the officer one
- [ ] Overview dashboard date-range filter (currently hardcoded to "today" — the underlying endpoint already supports any range, just needs the picker wired up)
- [ ] Overview dashboard trend arrows (the endpoint already returns them — `apps/web`'s `CustomerStatsPanel` already renders them — just needs porting to this app's `Card` component)

## Phase 2 — Officer & zone management

- [x] Officer search/list, with zone at a glance — `OfficersPage.tsx`
- [x] Officer detail — profile, current zone, contribution stats (today), full coverage history — `OfficerDetailPage.tsx`
- [x] Officer create (`POST /users/officers` — was `DirectorOnly`, broadened to `DirectorOrAdmin` so the CRM can actually call it)
- [ ] Officer edit / suspend from this page (creation and viewing are done; editing an existing officer's details, beyond zone reassignment, isn't yet)
- [x] Force password reset — `OfficerDetailPage.tsx`, generates a temporary password via the Supabase Admin API and SMS's it to the officer
- [x] Zone list/CRUD — `ZonesPage.tsx` (same `DirectorOnly` → `DirectorOrAdmin` broadening on create/delete)
- [ ] Zone coverage map/visual (list view with officer-per-zone exists; no geographic view)
- [x] Officer reassignment between zones — assign modal on `ZonesPage.tsx`, unassign button on `OfficerDetailPage.tsx`

## Phase 3 — Director management

- [x] Director list/CRUD — `DirectorsPage.tsx` (`POST /users/directors`, broadened the same way)
- [x] Suspend/reactivate — same page, reuses `PATCH /users/{id}/status` (also broadened from `DirectorOnly`)
- [ ] Director activity overview (which zones/officers they oversee) — not built; the list/create/suspend basics are

## Phase 4 — Financial reconciliation

- [x] Wallet ledger viewer — `GET /admin/crm/wallet-transactions`, filterable by category/type/date, paginated — `ReconciliationPage.tsx`
- [ ] Monnify transaction cross-check — genuinely not built. This needs live Monnify API credentials and reconciliation logic this environment can't exercise; flagged rather than faked
- [x] Discrepancy flagging — `GET /admin/crm/reconciliation-flags`: real integrity check comparing each wallet's current balance against its own most recent transaction record, not a placeholder
- [ ] A "resolve this flag" workflow (currently read-only — flags are surfaced, not yet actionable from the UI)

## Phase 5 — Disputes queue

- [x] Full dispute list/queue, filterable by status — `DisputesPage.tsx`. No new backend needed: `disputes.py` already treated admin as equivalent to director everywhere
- [x] Dispute detail + resolution workflow — claim, message thread, resolve, all wired to the existing endpoints

## Phase 6 — KYC / identity review

- [ ] Manual review queue for BVN/NIN edge cases — **investigated, not built**: the backend has no manual-review workflow to hook into. `bvn_linked`/`nin_linked` are plain booleans on `User`, and `identity_services.py` covers paid BVN/NIN lookup *purchases*, not a queue of pending verifications awaiting human approval. Building a review-queue UI without a real backend behind it would just be a mockup — flagged honestly instead of faked. If a real manual-review workflow gets built server-side later, this phase becomes buildable.
- [ ] Approve/reject actions with an audit trail — blocked on the above

## Phase 7 — Notifications / broadcasts

- [x] Compose & send broadcast UI — `BroadcastsPage.tsx`, targets everyone or one role, hits the existing `POST /notifications/broadcasts` (already `DirectorOrAdmin`, no change needed)
- [ ] Broadcast history / delivery stats (sending works; there's no view of past broadcasts or how many people actually got notified)
- [ ] Zone-targeted broadcasts (the backend supports a `zone_id` filter; the UI only offers role-targeting for now)

## Phase 8 — Audit log viewer

- [x] Searchable/filterable `AuditLog` table — `AuditLogPage.tsx`, filter by action/entity type, expandable rows showing before/after JSON. Broadened `GET /admin/audit-logs` from `DirectorOnly` to `DirectorOrAdmin`
- [x] Per-entry detail view (old value / new value diff) — the expand-row view

## Phase 9 — Business settings

- [x] Admin-friendly UI over `settings.py` — `BusinessSettingsPage.tsx`: view/edit plain config values inline, view (read-only) pending deferred rate changes. Broadened all of `settings.py` from `DirectorOnly` to `DirectorOrAdmin`
- [ ] Creating a new deferred rate change from the CRM (the preview → confirm flow is real and non-trivial; viewing pending changes is built, *initiating* one from this UI isn't yet — deliberately deferred rather than rushed, since it directly changes what customers get charged)

## Phase 10 — Reports / exports

- [x] Wallet ledger CSV export — `ReconciliationPage.tsx`, exports the currently-loaded page
- [ ] True platform-wide export across every page/filter combination in one file (current export is page-by-page; a real "export everything matching this filter" needs a backend endpoint that streams all matching rows, not just the 50 currently loaded client-side)
- [ ] Customer 360 / officer / director list exports (only the wallet ledger and the mobile `CustomerStatsPanel` have export buttons so far)

## Phase 11 — Polish & hardening

- [x] Access-control audit, first pass — every `DirectorOnly` endpoint the CRM actually calls was individually checked and broadened to `DirectorOrAdmin` where needed (see the note near the top of this file for the full list: users.py ×6, zones.py ×3, customer_stats.py ×2, admin.py ×3, settings.py ×7, plus admin_crm.py's own routes were `AdminOnly` from the start)
- [ ] A *second* pass confirming nothing was broadened further than it needed to be, done by someone other than whoever wrote the change
- [ ] Session timeout tuned specifically for this surface (currently reuses the same cookie lifetime as the mobile app)
- [ ] Re-authentication gate on the most sensitive write actions (e.g. suspending a director, editing business settings) — a step up from just being logged in
- [ ] Loading/empty/error states audited across every page systematically (each page built so far has its own loading skeleton and empty state, but no one has gone through checking for consistency/gaps)
- [ ] A short internal doc: how to log in, how 2FA works, what each module does

## Phase 12 — Pre-launch audit *(new — this round)*

This phase isn't CRM-specific — it covers the whole platform (backend + both frontends), since "ready to deploy" means more than the admin surface.

- [x] **RLS coverage audit — found a critical gap, fixed.** Eight tables (`zones`, `officer_credit_lines`, `system_config`, `zone_assignments`, `disputes`, `dispute_messages`, `billers`, `bill_payment_requests`) had **row-level security never enabled at all**, some since the very first migration. Since the mobile frontend holds a public Supabase anon key and talks to Supabase directly for Auth and one Realtime subscription, an unprotected table is reachable straight through Supabase's REST/Realtime API, completely bypassing the FastAPI backend's own access control. Migration `023_rls_coverage_gap.sql` enables RLS and adds policies mirroring the access rules already implemented in the corresponding FastAPI routes. **This one migration is the single most important thing to run before letting real users in.**
- [x] **Transaction locking audit.** Checked every `.with_for_update()` site in the codebase (withdrawals claim/approve/reject, card contribution posting, zone officer assignment) against the exact staleness bug found and fixed earlier this project in `wallet_service.py`. Every other site fetches its row for the *first* time under the lock, rather than re-fetching an already-loaded object — the wallet bug was a one-off, not a systemic pattern, and nothing else needed the same fix.
- [x] **Two targeted indexes added** (`024_performance_indexes.sql`) for the customer-stats/reconciliation aggregate queries built this session — a partial index for "does this card have any unwithdrawn record" and a composite for "most recent contribution per card", neither of which the existing index set served well.
- [x] **Test-data cleanup script** — `backend/scripts/clear_test_customers.py`. Deletes test customer accounts and every dependent row (cards, contributions, withdrawals, wallet, notifications, disputes, etc.) in correct FK order, since 18+ tables reference `users(id)` without `ON DELETE CASCADE` and a raw `DELETE FROM users` would fail. Dry-run by default; `--execute` to actually run it; `--keep <phone> <phone>` to preserve specific accounts.
- [ ] A genuine load/performance test under realistic concurrent traffic — the locking and indexing fixes are correct by inspection and by the specific bug they close, but neither has been measured under load from here
- [ ] Backups/point-in-time-recovery configuration on the production database — not something this session can configure, since it's a Supabase project dashboard setting, not application code
- [ ] Real Termii/Monnify production credentials swapped in (still referencing whatever's in your `.env` — this session can't verify those are live production keys vs sandbox ones)
