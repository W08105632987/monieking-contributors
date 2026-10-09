import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldAlert } from 'lucide-react'
import {
  IDLE_TIMEOUT_MS,
  getLastActivity,
  isIdleExpired,
  recordActivity as recordActivityShared,
} from '@/lib/activityTracker'
import { endSession } from '@/lib/sessionLifecycle'

const COUNTDOWN_SECONDS = 3             // "logging out in 3...2...1"
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const

interface InactivityMonitorProps {
  isAuthenticated: boolean
}

/**
 * Mounted exactly once at the App root (NOT inside AuthGuard, which
 * remounts on every route change and would reset this timer on every
 * navigation — a genuine idle timer has to survive that). Only actually
 * runs its logic while isAuthenticated is true.
 *
 * This component owns the in-app experience only: the countdown warning
 * and re-arming the timer. The authoritative "has this person been away
 * too long" decision lives in activityTracker.ts (shared, fails closed)
 * and is ALSO enforced independently of React by sessionLifecycle.ts —
 * before first paint on a cold start, and the instant the page becomes
 * visible again — so nothing about this component mounting late, or at
 * all, can let a stale session through.
 */
export function InactivityMonitor({ isAuthenticated }: InactivityMonitorProps) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const throttleRef = useRef(false)
  // No local copy of the timestamp on purpose: the shared clock in
  // localStorage is the single source of truth, so activity in another
  // context (the browser tab while this is the installed PWA, or the
  // reverse) counts, and a stale in-memory copy can never disagree with
  // what the boot gate and resume handler decided.

  const recordActivity = useCallback((ts: number = Date.now()) => {
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
        endSession('inactivity')
        return
      }
      setSecondsLeft(remaining)
    }, 1000)
  }, [clearTimers])

  const resetIdleTimer = useCallback((ms: number = IDLE_TIMEOUT_MS) => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      // Re-check the shared clock before warning anyone: if the person
      // was active in ANOTHER context since this timer was armed, this
      // one isn't idle at all — just wait out whatever time remains.
      const last = getLastActivity()
      if (last !== null && !isIdleExpired(last)) {
        resetIdleTimer(IDLE_TIMEOUT_MS - (Date.now() - last))
        return
      }
      startCountdown()
    }, ms)
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

    // Timers get throttled or fully frozen while the page is backgrounded,
    // so real elapsed time (from the shared clock) is what decides —
    // never "did my setTimeout fire". sessionLifecycle.ts already ends an
    // expired session the instant the page becomes visible; this handler
    // is the in-app half: if the person is NOT expired, resume with only
    // the genuinely remaining time (not a fresh full window — otherwise
    // locking and unlocking the screen repeatedly could stretch a session
    // forever), and as a belt-and-braces, end the session if somehow
    // nothing else already did (endSession is idempotent).
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      const last = getLastActivity()
      if (isIdleExpired(last)) {
        clearTimers()
        setSecondsLeft(null)
        endSession('inactivity')
      } else if (secondsLeftRef.current === null) {
        resetIdleTimer(IDLE_TIMEOUT_MS - (Date.now() - (last as number)))
      }
    }

    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, handleActivity, { passive: true }))
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // On mount (or whenever isAuthenticated becomes true): a fresh login
    // has just stamped the clock via setUser(); a session resumed after a
    // cold start was already vetted by the boot gate. If the clock is
    // nonetheless stale or missing here, something is wrong — fail closed.
    const last = getLastActivity()
    if (isIdleExpired(last)) {
      endSession('inactivity')
    } else {
      resetIdleTimer(IDLE_TIMEOUT_MS - (Date.now() - (last as number)))
    }

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, handleActivity))
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearTimers()
    }
  }, [isAuthenticated, resetIdleTimer, clearTimers, recordActivity])

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
