import { useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { MessageCircle, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { fireConfetti } from '@/lib/confetti'
import { useAuthStore } from '@/store/auth.store'
import { LogoLoader } from '@/components/ui/LogoLoader'
import { EASE_OUT } from '@/lib/motion'

interface Gate { title: string; message: string; button: string; link: string; required: boolean }

/**
 * The first thing a new customer sees. They cannot reach their dashboard until the SERVER has recorded their tap on
 * "Join". A closed app, a failed request or logging out does not count: the user's `whatsapp_joined_at` stays empty,
 * so this comes back on the next sign-in. If the director has not set a group link there is nothing to join, so
 * nobody is ever locked out by unfinished setup.
 */
export function WhatsAppGate({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const opened = useRef(false)
  // "Skip": remembered on this device only. The server record stays empty, so the director's numbers are unchanged and
  // the person can still join later from Profile > Contact support.
  const skipKey = `mk_wa_skip_${user?.id ?? ''}`
  const [skipped, setSkipped] = useState(() => { try { return !!localStorage.getItem(skipKey) } catch { return false } })
  const skip = () => { try { localStorage.setItem(skipKey, String(Date.now())) } catch { /* ignore */ } setSkipped(true) }

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['whatsapp-gate', user?.id],
    queryFn: async () => (await api.get<Gate>('/community/whatsapp')).data,
    retry: 1, staleTime: 0, refetchOnWindowFocus: false,
  })

  if (isLoading) return <div className="fixed inset-0 z-[900] flex items-center justify-center bg-green-50 dark:bg-night-800"><LogoLoader /></div>

  // Could not even load the message (offline?): stay on this screen. Never fall through to the dashboard.
  if (isError || !data) {
    return (
      <div className="fixed inset-0 z-[900] flex flex-col items-center justify-center gap-4 bg-green-50 px-8 text-center dark:bg-night-800">
        <p className="text-lg font-extrabold text-green-950 dark:text-white">We could not load this page</p>
        <p className="text-sm text-green-700 dark:text-night-100">Check your internet connection and try again.</p>
        <button onClick={() => refetch()} disabled={isFetching} className="flex items-center gap-2 rounded-full bg-green-900 px-6 py-3 text-sm font-bold text-white disabled:opacity-60 dark:bg-night-100 dark:text-night-900">
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Try again
        </button>
      </div>
    )
  }

  if (!data.required || skipped) return <>{children}</>

  const confirm = async () => {
    setBusy(true); setFailed(false)
    // Open the group FIRST, inside the tap, so phones do not block it as a pop-up.
    if (!opened.current) { window.open(data.link, '_blank', 'noopener,noreferrer'); opened.current = true }
    try {
      await api.post('/community/whatsapp/joined')
      fireConfetti({ count: 220 })
      if (user) setUser({ ...user, whatsapp_joined_at: new Date().toISOString() })
    } catch {
      setFailed(true)   // not recorded, so the dashboard stays locked: tap again
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center overflow-y-auto bg-green-950/95 px-5 py-8">
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
        onAnimationComplete={() => fireConfetti({ count: 170 })}
        role="dialog" aria-modal="true" aria-label={data.title}
        className="w-full max-w-sm rounded-[2rem] bg-white p-7 text-center shadow-2xl dark:bg-night-700">
        <motion.div animate={{ rotate: [0, -8, 8, -4, 0], scale: [1, 1.08, 1] }} transition={{ duration: 1.2, delay: 0.5 }}
          className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[#25D366] shadow-lg shadow-green-500/40">
          <MessageCircle className="h-10 w-10 text-white" strokeWidth={2.2} />
        </motion.div>
        <h1 className="text-2xl font-extrabold leading-tight text-green-950 dark:text-white">{data.title}</h1>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-green-700 dark:text-night-100">{data.message}</p>
        {failed && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">We could not confirm that. Check your connection and tap the button again. You need this step to continue.</p>}
        <button onClick={confirm} disabled={busy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[#25D366] py-4 text-base font-extrabold text-white shadow-lg shadow-green-500/30 transition-transform active:scale-95 disabled:opacity-60">
          <MessageCircle className="h-5 w-5" /> {busy ? 'Please wait…' : failed ? 'Tap again to continue' : data.button}
        </button>
        <button onClick={skip} disabled={busy} className="mt-3 w-full rounded-full py-3 text-sm font-bold text-green-700 dark:text-night-100">Skip for now</button>
        <p className="mt-1 text-[11px] text-green-500 dark:text-night-300">You can join any time from Profile, then Contact.</p>
      </motion.div>
    </div>
  )
}
