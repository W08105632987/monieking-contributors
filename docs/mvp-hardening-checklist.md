# MonieKing — Contribution MVP Hardening: Master Checklist

Everything discussed and confirmed this session, consolidated in one place. Check items off as they're shipped — this is the reference we both work from until the MVP is ready for the directors.

---

## 1. Registration safety
- [x] Officer with `zone_id = null` cannot register a customer — clear, specific error shown, not a silent failure or generic error
- [x] UI reflects this before submit (disabled state / inline message), not just a backend rejection after the fact

## 2. Centered modal for critical actions
- [x] Build reusable centered modal component for error/success feedback
- [x] Applied to: contribution marking, customer registration, customer deletion, withdrawal request/claim/reject, card creation
- [x] Everything else stays as the existing toast — no change there

## 3. Real bugs found and confirmed (not hosting/latency issues)
- [x] Card-grid staleness: `contribute` mutation invalidates `['cards']` but not `['card-grid', cardId]` — add the missing invalidation
- [x] Notification badge lag: badge count lives in a separate 20s poll from the message list; mark-as-read doesn't trigger an early badge refresh — wire it to refresh immediately on read

## 4. Director real-time (smart polling, not WebSockets — confirmed decision)
- [ ] Identify every director-side list/view that should reflect other users' actions without a manual refresh (customer deletion was the flagged example — audit for others: withdrawals list, officer roster, zone assignments)
- [ ] Add refetch-on-interval + refetch-on-focus to those queries

## 5. Officer zone badge
- [x] Persistent badge on officer dashboard showing assigned zone name
- [x] Distinct visual state when unassigned ("No zone assigned" — not just blank)

## 6. App-wide date filtering
- [x] Add custom date-range picker (from date → to date) alongside existing All time / Last month / 7 days filters — checked every file using this pattern: `director/AnalyticsPage.tsx` already had custom range built in, `director/ReportPage.tsx` is a pure display page driven by URL params (nothing to add), so `customer/WalletPage.tsx` was the only genuine gap — fixed there, backend `/wallets/me/summary` now accepts `start_date`/`end_date`
- [x] Director home hero card: add a "Today" option, not just monthly granularity

## 7. Per-officer Contribution Statistics (director → click officer)
- [ ] Contribution amount collected — day / week / custom range
- [ ] Number of cards withdrawn from
- [ ] Revenue generated from withdrawal charges (`charge_kobo`, already tracked per withdrawal — confirmed no schema gap)
- [ ] Top contributors for the period, ranked by amount
- [ ] Known limitation to keep in mind: withdrawal revenue attribution follows `customer.managing_officer_id` as it stands *today* — if a customer's managing officer changes, historical revenue attribution shifts with them, not frozen to who handled it at the time

## 8. Customer Statistics panel (the "legend") — new from the directors' meeting
**Core numbers, identical shape everywhere it appears:**
- [ ] Total Contributors = Food Contributors + Regular Contributors (exact identity)
- [ ] New Contributors (self-registered + officer-registered, both count)
- [ ] Active Contributors — at least one card with balance > 0
- [ ] Inactive Contributors — every card at ₦0 (covers both fully-withdrawn *and* never-funded, per your confirmed ruling — one clean computation, no special-casing)
- [ ] Bulk "ping" action — one message to every inactive customer in the current filtered view

**Placements and scope:**
- [ ] Director general dashboard — platform-wide, all zones
- [ ] Director → click officer — same panel, scoped to that officer's zone (zone-based, not "customers this officer personally registered")
- [ ] Officer's own dashboard — scoped to their own zone; **basic daily stats only, no filter picker on the dashboard itself**
- [ ] Officer "See more" → dedicated detail page with the full Today / 7 days / Custom filter and complete active/inactive lists

**Filters:**
- [ ] Today / 7 days / Custom range — everywhere this panel appears

**Officer-only additions:**
- [ ] Second inactivity definition: no contribution in 30+ days (separate from the universal all-cards-withdrawn definition)
- [ ] Distinct badges per customer so it's clear *which* inactivity reason applies (withdrawal-based, contribution-gap-based, or both)
- [ ] Tap-to-call button (`tel:` link) on every inactive customer, dialing their registered number directly
- [ ] Inactive list sorted oldest-gap-first (my addition, confirmed)

**My two additions, confirmed in scope:**
- [ ] Trend arrow (▲/▼ % vs previous period) on every stat in this panel
- [ ] "Total value currently active" figure — sum of all non-zero card balances, alongside the contributor counts

---

## 9. Wallet page — confirmed bugs, not hosting/latency (found while investigating your report)
- [x] `['wallet-transactions']` query is never invalidated by any mutation — checked every hook (bill payments, contributions, withdrawals): all invalidate `['wallet']` but none touch `['wallet-transactions']`. Same root cause as the card-grid bug in item #3, just a different query key. New transactions won't appear in the Recent Transactions list until the query happens to go stale on its own, regardless of hosting.
- [ ] Dispute action exists on `WalletPage.tsx` (dashboard's recent-transactions row) but is completely absent from `TransactionsPage.tsx` (the full transactions list) — confirmed by direct search, zero mentions of "dispute" in that file. **Fixed for the customer portal only** — checked the backend (`create_dispute` is gated `CustomerOnly`) and confirmed officers don't have a dispute button anywhere else in their portal either (not even on their own Wallet page). Disputes are architecturally a customer-only concept; officers *resolve* disputes, they don't raise them about their own wallet. Adding the button to the officer's Transactions page would have called an endpoint that rejects officers outright — that would've been a new bug, not a fix, so left alone. Flag this back if officers should actually be able to dispute something and I'm missing context.
- [ ] Worth reusing: `useWithdrawalRealtime.ts` already exists and is presumably why withdrawal requests already feel instant — check whether the same pattern can be extended to wallet transactions instead of building something new from scratch

## Build order (proposed, open to reordering if you'd rather sequence differently)
1. Registration zone-check + card-grid/notification/wallet-transaction bug fixes + dispute button on the full Transactions list (all small, isolated, no dependencies on anything else)
2. Centered modal component (used by several later items)
3. Officer zone badge + app-wide date-range filter component (small, reusable pieces other items depend on)
4. Customer Statistics panel — backend aggregation queries first, then the shared frontend component, then wire it into all three placements
5. Per-officer Contribution Statistics
6. Director smart-polling pass — last, since it's easiest to verify once everything above is stable and there's more surface area to actually watch update live

Let me know if this order works or if something's more urgent to see first — otherwise I'll start at the top.

## 10. Two follow-ups from Phase 3 testing
- [x] Zone badge showed the pin icon but no zone name — real end-to-end gap, not a display bug: the `User` type/schema never had a `zone_name` field at all (I'd written `user.zone_name` assuming it existed, confused it with a similarly-named field on a *different* type, `ZoneAssignmentHistory`). Fixed properly: `/users/me` now does its own small, independent zone lookup by `zone_id` (deliberately NOT via lazy-loading the relationship on `current_user`, which could be the cached/unattached object from the earlier caching work — same lesson as before, don't touch the hot-path dependency for something like this) and returns `zone_name` explicitly. Added the field to `UserResponse`, `User` (frontend type), all the way through.
- [x] Wallet/Transactions page had no date filter on the actual transaction list — the summary stat cards had range filtering (Phase 3), but the full transaction list (`TransactionsPage.tsx`) was a separate query with only pagination, no date params at all. Added `start_date`/`end_date` to `/wallets/me/transactions` (same convention as the summary endpoint) and a matching date-range chip + inputs on the page, alongside the existing All/Money in/Money out filter.

## 11. Critical: false logout on every refresh (app-wide)
- [x] Root cause found: your Windows machine is hitting intermittent DNS resolution failures reaching the Supabase database (`socket.gaierror: getaddrinfo failed` in the logs — a real network issue on your end, not a code bug), which makes /users/me occasionally fail with a 500 instead of a clean response. The auth store persists to localStorage, and fetchProfile()'s catch block was calling logout() for ANY error, not just a real 401 — so a transient network blip was wiping a perfectly valid session (localStorage, wallet store, notifications store, and the entire query cache) on every refresh unlucky enough to hit one. Fixed: only a genuine 401 triggers logout now; anything else retries automatically (up to 2 extra attempts) and, failing that, leaves the persisted session untouched rather than destroying it.
- [ ] Separate, unresolved: "changes only visible after refresh" — very likely the same dev-server-as-production issue flagged after Phase 2. This is now recurring, not a one-off, and needs an actual `npm run build` deployment before director launch, not just another hard refresh.
