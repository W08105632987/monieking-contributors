import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldAlert } from 'lucide-react'
import { getStoredLastActivity, recordActivity as recordActivityShared } from '@/lib/activityTracker'

const IDLE_TIMEOUT_MS = 2 * 60 * 1000   // 2 minutes of no interaction
const COUNTDOWN_SECONDS = 3             // "logging out in 3...2...1"
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const

interface InactivityMonitorProps {
  isAuthenticated: boolean
  onLogout: () => void
}

/**
 * Mounted exactly once at the App root (NOT inside AuthGuard, which
 * remounts on every route change and would reset this timer on every
 * navigation — a genuine idle timer has to survive that). Only actually
 * runs its logic while isAuthenticated is true.
 */
export function InactivityMonitor({ isAuthenticated, onLogout }: InactivityMonitorProps) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const throttleRef = useRef(false)
  // Real wall-clock timestamp, not just "a timer is running" — this is
  // what lets us tell, on wake OR on a fresh mount after a Chrome
  // discard-and-reload, whether the person actually went idle too long
  // in real time, independent of whether a setTimeout tracking it got
  // throttled, fully paused, or simply erased along with the rest of
  // the page. Seeded from sessionStorage, not just Date.now(), for
  // exactly that reason — see getStoredLastActivity above.
  const lastActivityRef = useRef<number>(getStoredLastActivity())

  const recordActivity = useCallback((ts: number = Date.now()) => {
    lastActivityRef.current = ts
    recordActivityShared(ts)
  }, [])

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    idleTimerRef.current = null
    countdownRef.current = null
  }, [])

  const startCountdown = useCallback(() => {
    setSecondsLeft(COUNTDOWN_SECONDS)
    let remaining = COUNTDOWN_SECONDS
    countdownRef.current = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        clearTimers()
        setSecondsLeft(null)
        sessionStorage.setItem('mk_logout_reason', 'inactivity')
        onLogout()
        return
      }
      setSecondsLeft(remaining)
    }, 1000)
  }, [clearTimers, onLogout])

  const resetIdleTimer = useCallback((ms: number = IDLE_TIMEOUT_MS) => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(startCountdown, ms)
  }, [startCountdown])

  const stayLoggedIn = useCallback(() => {
    clearTimers()
    setSecondsLeft(null)
    recordActivity()
    resetIdleTimer()
  }, [clearTimers, recordActivity, resetIdleTimer])

  const secondsLeftRef = useRef<number | null>(null)
  useEffect(() => {
    secondsLeftRef.current = secondsLeft
  }, [secondsLeft])

  useEffect(() => {
    if (!isAuthenticated) {
      clearTimers()
      setSecondsLeft(null)
      return
    }

    // Re-sync from storage every time this effect starts running for a
    // newly-true isAuthenticated — NOT just trust whatever the in-memory
    // ref already holds. This is what actually closes the login bug:
    // auth.store.ts stamps sessionStorage with a fresh timestamp the
    // moment a login succeeds, but that update happens from OUTSIDE
    // this component (a plain store, not this component's own code),
    // so the in-memory ref alone would never see it — it would stay
    // pointed at whatever stale value it last had, and the mount-time
    // check below would keep reading that stale value forever. Pulling
    // from storage here, fresh, every time, means a login's fresh
    // stamp is always picked up before the staleness check runs.
    lastActivityRef.current = getStoredLastActivity()

    const handleActivity = () => {
      // While the countdown warning is showing, any interaction that
      // ISN'T the "Stay logged in" button shouldn't silently cancel it —
      // that could mean a stray scroll dismisses a warning the person
      // never actually saw. Only the explicit button does that (see
      // stayLoggedIn). Otherwise, throttle so a scroll/mousemove storm
      // doesn't reset a timer hundreds of times a second.
      if (secondsLeftRef.current !== null) return
      if (throttleRef.current) return
      throttleRef.current = true
      setTimeout(() => { throttleRef.current = false }, 1000)
      recordActivity()
      resetIdleTimer()
    }

    // Two separate real-world-time checks, both needed:
    //
    // 1. handleVisibilityChange — the tab was merely paused/throttled
    //    (screen locked briefly, switched apps for a moment), NOT
    //    discarded. The component instance is still alive, so this
    //    listener actually gets to run when the tab becomes visible
    //    again. Checks elapsed real time against the stored timestamp.
    //
    // 2. The check right after this comment, run once on mount — for
    //    when the tab WAS discarded and reloaded from scratch (see the
    //    big comment on getStoredLastActivity above). There's no
    //    "the old listener wakes back up" in that case; this is a
    //    brand-new component instance, and the ONLY way it can know
    //    time already passed is by reading the persisted timestamp
    //    immediately as part of mounting, not waiting for an event
    //    that has nothing left to fire on.
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      const elapsed = Date.now() - lastActivityRef.current
      if (elapsed >= IDLE_TIMEOUT_MS) {
        // Already idle too long in real time while asleep/backgrounded
        // — the person wasn't there to see a "still there?" countdown,
        // so skip straight to logging out rather than showing one now.
        clearTimers()
        setSecondsLeft(null)
        sessionStorage.setItem('mk_logout_reason', 'inactivity')
        onLogout()
      } else if (secondsLeftRef.current === null) {
        // Not idle long enough yet — resume with only the genuinely
        // remaining time, not a fresh full window. Otherwise someone
        // could extend their effective session indefinitely just by
        // repeatedly locking and unlocking the screen before the timer
        // caught up.
        resetIdleTimer(IDLE_TIMEOUT_MS - elapsed)
      }
    }

    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, handleActivity, { passive: true }))
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // The mount-time check for case 2 above — run it immediately,
    // synchronously, before anything else, so a discard-and-reload
    // that happened while the person was away too long logs them out
    // right away instead of silently starting a fresh 2-minute window.
    const elapsedSinceMount = Date.now() - lastActivityRef.current
    if (elapsedSinceMount >= IDLE_TIMEOUT_MS) {
      sessionStorage.setItem('mk_logout_reason', 'inactivity')
      onLogout()
    } else {
      resetIdleTimer(IDLE_TIMEOUT_MS - elapsedSinceMount)
    }

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, handleActivity))
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearTimers()
    }
  }, [isAuthenticated, resetIdleTimer, clearTimers, onLogout, recordActivity])

  if (!isAuthenticated) return null

  return (
    <>
      {import.meta.env.DEV && (
        <div className="fixed bottom-2 left-2 z-[200] bg-black/70 text-white text-[10px] px-2 py-1 rounded font-mono pointer-events-none">
          idle-monitor: {secondsLeft !== null ? `counting down ${secondsLeft}s` : 'armed'}
        </div>
      )}
      <AnimatePresence>
      {secondsLeft !== null && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center px-6"
        >
          <div className="absolute inset-0 bg-green-950/70 backdrop-blur-sm" />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="relative bg-white dark:bg-night-700 rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl"
          >
            <div className="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="w-7 h-7 text-amber-500 dark:text-amber-300" />
            </div>
            <p className="text-green-900 dark:text-white font-extrabold text-lg mb-1">Still there?</p>
            <p className="text-green-500 dark:text-night-300 text-sm mb-4">
              For your security, you'll be logged out in
            </p>
            <p className="text-amber-500 dark:text-amber-300 font-extrabold text-4xl mb-5 tabular-nums">{secondsLeft}</p>
            <button
              onClick={stayLoggedIn}
              className="w-full bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all"
            >
              I'm still here
            </button>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </>
  )
}
