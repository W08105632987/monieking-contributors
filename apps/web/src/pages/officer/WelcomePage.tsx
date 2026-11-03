import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUpRight, Calendar, Check, ChevronLeft, ChevronRight, Clock, Eye, Coins, ListChecks, Plus, RotateCcw, ShieldCheck, Sparkles, TrendingUp, Users } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'
import { cn, formatNaira } from '@/lib/utils'
import { FitAmount } from '@/components/ui/FitAmount'

/**
 * An exact, non-interactive snapshot of the real officer card screen (pages/officer/CardDetailPage.tsx):
 * same classes, same structure, same order, with demo numbers. It is drawn at a real phone width (390px) and
 * scaled down so it looks exactly like the screen the officer will use. Nothing here is real data.
 */
const SNAP_W = 390
const SNAP_H = 640
function DemoOfficerScreen({ scale = 0.72 }: { scale?: number }) {
  const days = 14, rate = 500_00, progress = Math.round((days / 372) * 100)
  const Callout = ({ n, style }: { n: number; style: CSSProperties }) => (
    <span style={style} className="absolute z-20 flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-base font-extrabold text-green-950 shadow-lg ring-2 ring-white">{n}</span>
  )
  return (
    <div className="mx-auto overflow-hidden rounded-[2.2rem] border-[6px] border-green-950 shadow-xl dark:border-night-900"
      style={{ width: SNAP_W * scale + 12, height: SNAP_H * scale + 12 }} aria-hidden="true">
      <div className="pointer-events-none origin-top-left select-none bg-green-50 dark:bg-night-800"
        style={{ width: SNAP_W, height: SNAP_H, transform: `scale(${scale})`, position: 'relative' }}>
        <header className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-green-200 bg-white dark:border-night-500 dark:bg-night-700"><ChevronLeft className="h-5 w-5 text-green-700 dark:text-night-100" /></div>
          <div>
            <h1 className="text-lg font-extrabold leading-tight text-green-900 dark:text-white">📋 Regular Card</h1>
            <p className="text-xs text-green-400 dark:text-night-300">Card #1 · Ngozi Demo</p>
          </div>
          <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">Active</span>
        </header>
        <div className="px-4">
          <div className="relative mb-5 mt-2 h-[200px] w-full overflow-hidden rounded-3xl">
            <div className="relative flex h-full w-full flex-col justify-between overflow-hidden p-5" style={{ background: 'linear-gradient(135deg, #052E16 0%, #064E3B 55%, #065F46 100%)' }}>
              <div className="absolute rounded-full opacity-25" style={{ width: 150, height: 150, background: '#059669', top: -40, right: -30 }} />
              <div className="absolute rounded-full opacity-15" style={{ width: 90, height: 90, background: '#34D399', top: 10, right: 20 }} />
              <div className="relative z-10 flex items-start justify-between">
                <div><p className="text-xs font-semibold uppercase tracking-widest text-green-300">MonieKing</p><p className="mt-0.5 text-xs text-green-500">Contributors</p></div>
                <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-400">📋 Regular</span>
              </div>
              <div className="relative z-10">
                <p className="mb-1 text-xs uppercase tracking-wide text-green-400">Daily Rate</p>
                <FitAmount className="text-3xl font-extrabold tracking-tight text-amber-400">{formatNaira(rate)}</FitAmount>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-green-800"><div className="h-full rounded-full" style={{ width: `${progress}%`, background: '#F59E0B' }} /></div>
                <div className="mt-1.5 flex justify-between"><p className="text-xs text-green-400">{days} / 372 days</p><p className="text-xs text-green-400">{progress}%</p></div>
                <div className="mt-2 flex items-center gap-1"><RotateCcw className="h-3 w-3 text-green-500" /><p className="text-xs text-green-500">Tap to see contribution grid</p></div>
              </div>
            </div>
          </div>
          <div className="mb-5 grid grid-cols-3 gap-3">
            {[[TrendingUp, 'text-green-500', String(days), 'Days saved', 'text-lg'], [Calendar, 'text-amber-500', String(372 - days), 'Days left', 'text-lg'], [Clock, 'text-green-500', formatNaira(days * rate), 'Total saved', 'text-sm']].map(([Icon, c, v, l, sz]) => {
              const I = Icon as typeof Clock
              return (
                <div key={l as string} className="rounded-2xl border border-green-100 bg-white p-3 shadow-card dark:border-night-500 dark:bg-night-700">
                  <I className={cn('mb-1 h-4 w-4', c as string)} />
                  <p className={cn('font-extrabold text-green-900 dark:text-white', sz as string)}>{v as string}</p>
                  <p className="text-xs text-green-400 dark:text-night-300">{l as string}</p>
                </div>
              )
            })}
          </div>
          <div className="mb-3 flex gap-3">
            <div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-green-900 py-3.5 text-sm font-bold text-white shadow-card"><Plus className="h-4 w-4 shrink-0" /> Post contribution</div>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full border-2 border-green-200 py-3.5 text-sm font-bold text-green-700 dark:border-night-500 dark:text-night-100"><ArrowUpRight className="h-4 w-4 shrink-0" /> Withdraw</div>
          </div>
          <div className="mb-5 mt-4 rounded-2xl border border-green-100 bg-white p-4 shadow-card dark:border-night-500 dark:bg-night-700">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-green-700 dark:text-night-100">Amount (₦)</p>
            <div className="relative mb-2">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-green-500">₦</span>
              <div className="w-full rounded-xl border-2 border-green-200 py-3 pl-8 pr-4 text-sm font-semibold text-green-900 dark:border-night-500 dark:text-white">1,500</div>
            </div>
            <div className="mb-3 flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-night-200"><Check className="h-3 w-3" /> 3 day(s) will be marked</div>
            <div className="w-full rounded-full bg-green-900 py-3.5 text-center text-sm font-bold text-white">Confirm contribution</div>
          </div>
        </div>
        <Callout n={1} style={{ left: 8, top: 150 }} />
        <Callout n={2} style={{ left: 8, top: 398 }} />
        <Callout n={3} style={{ right: 8, top: 560 }} />
      </div>
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
        <p className="mb-4 text-sm text-green-700 dark:text-night-100">This is exactly how a customer's card looks when you open it. Demo numbers only.</p>
        <DemoOfficerScreen />
        <ol className="mt-5 space-y-2 text-xs text-green-800 dark:text-night-100">
          {['This is the customer’s card. It shows the daily rate and how many days are saved.', 'Tap “Post contribution” only after you have collected the customer’s money.', 'Type exactly what they paid, check the days it will mark, then confirm and show them the result.'].map((t, n) => (
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
      </div>
    ),
  ]
  const last = i === slides.length - 1
  const go = (n: number) => setI(Math.max(0, Math.min(slides.length - 1, n)))
  const onDragEnd = (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
    if (info.offset.x < -50 || info.velocity.x < -400) go(i + 1)
    else if (info.offset.x > 50 || info.velocity.x > 400) go(i - 1)
  }

  // Fixed to the screen (not min-height) so the buttons are always on screen and only the middle scrolls.
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-green-50 dark:bg-night-800">
      <div className="flex h-12 shrink-0 items-center justify-end px-4 pt-safe">
        {!last && <button onClick={() => finish('/officer/dashboard')} className="px-2 py-2 text-xs font-bold text-green-600 dark:text-night-300">Skip</button>}
      </div>
      <motion.div className="min-h-0 flex-1 overflow-y-auto px-6 py-2" style={{ touchAction: 'pan-y' }}
        drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.2} onDragEnd={onDragEnd}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={i} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }} className="mx-auto max-w-md pb-4">
            {slides[i]}
          </motion.div>
        </AnimatePresence>
      </motion.div>
      <div className="shrink-0 border-t border-green-100 bg-green-50 px-6 pb-safe pt-3 dark:border-night-600 dark:bg-night-800" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
        <div className="mb-3 flex justify-center gap-1.5">{slides.map((_, n) => <button key={n} aria-label={`Go to step ${n + 1}`} onClick={() => go(n)} className={cn('h-2 rounded-full transition-all', n === i ? 'w-6 bg-green-700' : 'w-2 bg-green-200 dark:bg-night-500')} />)}</div>
        <div className="mx-auto max-w-md">
          {!last ? (
            <div className="flex gap-3">
              {i > 0 && <button onClick={() => go(i - 1)} aria-label="Back" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-green-200 text-green-700 dark:border-night-500 dark:text-night-100"><ChevronLeft className="h-5 w-5" /></button>}
              <button onClick={() => go(i + 1)} className="flex h-12 flex-1 items-center justify-center gap-1 rounded-full bg-green-900 text-sm font-bold text-white dark:bg-night-100 dark:text-night-900">{i === 0 ? 'Show me how it works' : 'Next'}<ChevronRight className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="space-y-2">
              <button disabled={finishing} onClick={() => finish('/officer/profile')} className="h-12 w-full rounded-full bg-green-900 text-sm font-bold text-white disabled:opacity-60 dark:bg-night-100 dark:text-night-900">Set up my profile</button>
              <button disabled={finishing} onClick={() => finish('/officer/dashboard')} className="h-11 w-full rounded-full border border-green-200 text-sm font-bold text-green-800 disabled:opacity-60 dark:border-night-500 dark:text-night-100">Start now, I will do it later</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
