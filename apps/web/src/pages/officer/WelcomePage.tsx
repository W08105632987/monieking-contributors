import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronLeft, ChevronRight, Eye, Coins, ListChecks, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'
import { cn, formatNaira } from '@/lib/utils'

/** A picture of what an officer's card screen looks like, with numbered callouts. Pure demo data, nothing here is real. */
function DemoOfficerScreen() {
  const marked = 14
  return (
    <div className="relative mx-auto w-[250px] rounded-[2rem] border-[6px] border-green-950 bg-green-50 p-3 shadow-xl dark:border-night-900">
      <div className="mx-auto mb-2 h-1.5 w-14 rounded-full bg-green-950/80" />
      <p className="text-[9px] font-bold uppercase tracking-widest text-green-500">Demo officer account</p>
      <p className="text-sm font-extrabold text-green-950">Ngozi Demo</p>
      <div className="mt-1.5 flex items-center justify-between rounded-xl bg-white p-2 shadow-sm">
        <div><p className="text-[10px] font-bold text-green-900">Regular card · ₦500/day</p><p className="text-[9px] text-green-500">{marked} of 31 days marked</p></div>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-bold text-green-700">Active</span>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 rounded-xl bg-white p-2 shadow-sm">
        {Array.from({ length: 31 }, (_, i) => {
          const day = i + 1, done = day <= marked, today = day === marked + 1
          return (
            <div key={day} className={cn('flex aspect-square items-center justify-center rounded-md text-[8px] font-bold',
              done ? 'bg-green-600 text-white' : today ? 'bg-amber-400 text-green-950 ring-2 ring-amber-300' : 'bg-green-50 text-green-400')}>
              {done ? <Check className="h-2.5 w-2.5" /> : day}
            </div>
          )
        })}
      </div>
      <div className="mt-2 rounded-full bg-green-900 py-2 text-center text-[10px] font-bold text-white">Mark today</div>
      {[
        ['1', '-left-3 top-[3.9rem]', 'bg-amber-400'],
        ['2', '-right-3 top-[9.5rem]', 'bg-amber-400'],
        ['3', '-right-3 bottom-[1.6rem]', 'bg-amber-400'],
      ].map(([n, pos, bg]) => <span key={n} className={cn('absolute flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold text-green-950 shadow', pos, bg)}>{n}</span>)}
    </div>
  )
}

export default function OfficerWelcomePage() {
  const navigate = useNavigate()
  const { user, setUser } = useAuthStore()
  const [i, setI] = useState(0)
  const [finishing, setFinishing] = useState(false)
  const { data } = useQuery({ queryKey: ['officer-earnings-me'], queryFn: async () => (await api.get<{ percent: number }>('/officer-earnings/me')).data })
  const pct = data?.percent ?? 30
  const first = (user?.full_name ?? 'there').split(' ')[0]

  const finish = async (to: string) => {
    setFinishing(true)
    try { await api.post('/officer-earnings/me/welcome-seen') } catch { /* they can still continue */ }
    if (user) setUser({ ...user, officer_welcome_seen_at: new Date().toISOString() })
    navigate(to, { replace: true })
  }

  const slides = [
    (
      <div className="text-center">
        <div className="mb-5 flex justify-center"><BrandBlobLogo height={56} /></div>
        <p className="text-xs font-bold uppercase tracking-widest text-amber-500">Welcome</p>
        <h1 className="mt-1 text-3xl font-extrabold leading-tight text-green-950 dark:text-white">Welcome to the MonieKing family, {first}!</h1>
        <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-green-700 dark:text-night-100">
          We are glad to have you. As an affiliated officer you look after customers' savings cards, and you earn from every customer you serve well. This quick tour shows you how it all works. It takes about a minute.
        </p>
      </div>
    ),
    (
      <div>
        <div className="mb-3 flex items-center gap-2"><Coins className="h-6 w-6 text-amber-500" /><h2 className="text-2xl font-extrabold text-green-950 dark:text-white">How you earn</h2></div>
        <p className="text-sm leading-relaxed text-green-700 dark:text-night-100">When one of your customers withdraws, the company collects a charge: one day's rate for every month of contributions they take out. You get a share of it, <b>{pct}%</b>, and it lands in your earnings automatically once the withdrawal is paid.</p>
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-card dark:bg-night-700">
          <p className="text-xs font-bold text-green-600 dark:text-night-300">Example: one month on a ₦1,000 card</p>
          <div className="mt-2 flex h-9 overflow-hidden rounded-xl text-xs font-extrabold">
            <div style={{ width: `${pct}%` }} className="flex items-center justify-center bg-amber-400 text-green-950">You {formatNaira(1000_00 * pct / 100)}</div>
            <div style={{ width: `${100 - pct}%` }} className="flex items-center justify-center bg-green-800 text-white">Company {formatNaira(1000_00 * (100 - pct) / 100)}</div>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-green-700 dark:text-night-100">The more customers you have, and the more months they save, the more you earn. You can request a payout from your Earnings page any time.</p>
      </div>
    ),
    (
      <div>
        <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-green-600" /><h2 className="text-2xl font-extrabold text-green-950 dark:text-white">The rules</h2></div>
        <div className="space-y-3">
          {[
            [ListChecks, 'Mark every card carefully', 'Mark a day only when you have really collected that day’s money. A wrong mark is the customer’s money and your reputation.'],
            [Eye, 'Show the customer their marked card', 'After you mark, show the customer the screen with the tick on it. This is how they trust you, and it avoids disputes later.'],
            [Users, 'Look after your customers', 'Answer them, keep their details private, and never share a customer’s PIN or password.'],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof Users
            return (
              <div key={t as string} className="flex gap-3 rounded-2xl bg-white p-3.5 shadow-card dark:bg-night-700">
                <I className="mt-0.5 h-5 w-5 shrink-0 text-green-700 dark:text-night-100" />
                <div><p className="text-sm font-extrabold text-green-950 dark:text-white">{t as string}</p><p className="text-xs leading-relaxed text-green-700 dark:text-night-200">{d as string}</p></div>
              </div>
            )
          })}
        </div>
      </div>
    ),
    (
      <div>
        <h2 className="mb-1 text-2xl font-extrabold text-green-950 dark:text-white">This is your screen</h2>
        <p className="mb-5 text-sm text-green-700 dark:text-night-100">A demo account, so you know what to expect.</p>
        <DemoOfficerScreen />
        <ol className="mt-5 space-y-2 text-xs text-green-800 dark:text-night-100">
          {['Open a customer and pick their card. Green days are marked.', 'The yellow day is today. Tap “Mark today” once you have collected.', 'Show the customer the tick. That is their proof.'].map((t, n) => (
            <li key={n} className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[11px] font-extrabold text-green-950">{n + 1}</span>{t}</li>
          ))}
        </ol>
      </div>
    ),
    (
      <div>
        <div className="mb-3 flex items-center gap-2"><Sparkles className="h-6 w-6 text-amber-500" /><h2 className="text-2xl font-extrabold text-green-950 dark:text-white">Before your first payout</h2></div>
        <p className="mb-4 text-sm leading-relaxed text-green-700 dark:text-night-100">Set up your profile so your money can reach you. If your bank details are missing when you ask for a payout, it will not go through.</p>
        <div className="space-y-2.5">
          {['Add your bank details', 'Add your next of kin', 'Set your payment PIN'].map((t) => (
            <div key={t} className="flex items-center gap-3 rounded-2xl bg-white p-3.5 text-sm font-bold text-green-950 shadow-card dark:bg-night-700 dark:text-white"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-700"><Check className="h-3.5 w-3.5" /></span>{t}</div>
          ))}
        </div>
        <button disabled={finishing} onClick={() => finish('/officer/profile')} className="mt-5 w-full rounded-full bg-green-900 py-3.5 text-sm font-bold text-white dark:bg-night-100 dark:text-night-900">Set up my profile</button>
        <button disabled={finishing} onClick={() => finish('/officer/dashboard')} className="mt-2 w-full rounded-full border border-green-200 py-3.5 text-sm font-bold text-green-800 dark:border-night-500 dark:text-night-100">Start now, I will do it later</button>
      </div>
    ),
  ]
  const last = i === slides.length - 1

  return (
    <div className="flex min-h-dvh flex-col bg-green-50 dark:bg-night-800">
      <div className="flex justify-end px-4 pt-4">
        {!last && <button onClick={() => finish('/officer/dashboard')} className="text-xs font-bold text-green-600 dark:text-night-300">Skip</button>}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }} className="mx-auto max-w-md">
            {slides[i]}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="px-6 pb-8 pt-2">
        <div className="mb-4 flex justify-center gap-1.5">{slides.map((_, n) => <span key={n} className={cn('h-1.5 rounded-full transition-all', n === i ? 'w-6 bg-green-700' : 'w-1.5 bg-green-200 dark:bg-night-500')} />)}</div>
        {!last && (
          <div className="mx-auto flex max-w-md gap-3">
            {i > 0 && <button onClick={() => setI(i - 1)} aria-label="Back" className="flex h-12 w-12 items-center justify-center rounded-full border border-green-200 text-green-700 dark:border-night-500 dark:text-night-100"><ChevronLeft className="h-5 w-5" /></button>}
            <button onClick={() => setI(i + 1)} className="flex flex-1 items-center justify-center gap-1 rounded-full bg-green-900 py-3.5 text-sm font-bold text-white dark:bg-night-100 dark:text-night-900">{i === 0 ? 'Show me how it works' : 'Next'}<ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    </div>
  )
}
