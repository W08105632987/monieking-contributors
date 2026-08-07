// ── Feature flags ────────────────────────────────────────────────
// Temporarily disable a feature app-wide without touching the
// underlying implementation. The code, endpoints, and data model all
// stay exactly as they are — this only controls whether the UI lets
// someone reach them. Flip back to `true` when ready to re-enable;
// nothing else needs to change.
//
// Both are OFF for initial launch:
//   - WITHDRAWALS: bank withdrawal (both wallet-instant and
//     card-withdrawal) depends on Monnify disbursement being fully
//     live-ready (OTP disabled + IP whitelisted on Monnify's side —
//     see the go-live checklist). Until that's confirmed working,
//     every withdrawal attempt would just fail.
//   - BIOMETRICS: re-enable once the whole biometric flow (login,
//     bank details, withdrawals) has had a full pass on a live
//     deployment, not just sandbox/dev testing.
export const FEATURE_FLAGS = {
  WITHDRAWALS_ENABLED: false,
  BIOMETRICS_ENABLED:  false,
} as const
