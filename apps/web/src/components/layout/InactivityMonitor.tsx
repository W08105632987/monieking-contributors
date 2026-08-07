import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldAlert } from 'lucide-react'

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
  // what lets us tell, on wake, whether we actually went idle-too-long
  // in real time, independent of whether the setTimeout tracking it
  // got throttled or fully paused while the screen was off.
  const lastActivityRef = useRef<number>(Date.now())

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
    lastActivityRef.current = Date.now()
    resetIdleTimer()
  }, [clearTimers, resetIdleTimer])

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
      lastActivityRef.current = Date.now()
      resetIdleTimer()
    }

    // The actual bug fix: setTimeout/setInterval get throttled or fully
    // suspended by the browser/OS while a screen is locked or the tab
    // is backgrounded — so the idle timer effectively just pauses,
    // rather than continuing to track real time. That's why waking the
    // phone was resuming the page instead of expiring the session: the
    // timer hadn't actually fired yet by its own (paused) count, even
    // though real wall-clock time had long since blown past the idle
    // window. On resume, check REAL elapsed time against Date.now()
    // instead of trusting the paused timer.
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
    resetIdleTimer()

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, handleActivity))
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearTimers()
    }
  }, [isAuthenticated, resetIdleTimer, clearTimers, onLogout])

  if (!isAuthenticated) return null

  return (
    <AnimatePresence>
      {secondsLeft !== null && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center px-6"
        >
          <div className="absolute inset-0 bg-green-950/70 backdrop-blur-sm" />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="relative bg-white rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl"
          >
            <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="w-7 h-7 text-amber-500" />
            </div>
            <p className="text-green-900 font-extrabold text-lg mb-1">Still there?</p>
            <p className="text-green-500 text-sm mb-4">
              For your security, you'll be logged out in
            </p>
            <p className="text-amber-500 font-extrabold text-4xl mb-5 tabular-nums">{secondsLeft}</p>
            <button
              onClick={stayLoggedIn}
              className="w-full bg-green-900 text-white font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all"
            >
              I'm still here
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
