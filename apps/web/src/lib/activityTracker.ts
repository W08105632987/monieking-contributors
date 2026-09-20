// Shared with InactivityMonitor.tsx — pulled out to its own module
// specifically so auth.store.ts (a plain store, not a React component)
// can also stamp "the person was just active" at the one moment that
// matters most and was previously missed entirely: a successful login.
//
// Bug this fixes: InactivityMonitor is mounted once at the App root
// and never unmounts. Its activity listeners are only attached while
// isAuthenticated is true, so the moment an auto-logout fires, the
// stored timestamp freezes at "right before going idle" and nothing
// ever updates it again while signed out — typing a phone number and
// password on the login page doesn't touch this at all. When the next
// login then succeeds and isAuthenticated flips back to true,
// InactivityMonitor's mount-time check reads that frozen, already
// years-old-feeling (well, 2-minutes-old-and-counting) timestamp,
// concludes the person is still idle past the timeout, and logs them
// straight back out — instantly, silently, with no error, because
// nothing actually went wrong from that check's point of view. A
// refresh "fixed" it only because it happened to land in a fresh
// session with no stale timestamp to trip over.
//
// The fix: a successful login IS activity, obviously — auth.store.ts
// calls recordActivity() the moment it sets a real user, so by the
// time InactivityMonitor re-evaluates, the timestamp is already
// current and the staleness check correctly finds nothing wrong.
const LAST_ACTIVITY_KEY = 'mk_last_activity'

export function getStoredLastActivity(): number {
  const stored = sessionStorage.getItem(LAST_ACTIVITY_KEY)
  const parsed = stored ? parseInt(stored, 10) : NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

export function recordActivity(ts: number = Date.now()) {
  try { sessionStorage.setItem(LAST_ACTIVITY_KEY, String(ts)) } catch { /* non-fatal — falls back to in-memory-only behavior */ }
}
