import { useGoBack } from '@/hooks/useGoBack'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BookOpen, CalendarDays, ChevronLeft, ChevronRight, Search, ShieldAlert, X, ChevronDown } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { EASE_OUT } from '@/lib/motion'

interface Cover { id: string; name: string; role: string; is_me: boolean; actions_today: number; actions_total: number; last_action_at: string | null }
interface Entry { id: string; time: string; at: string; label: string; category: string; sensitive: boolean; ok: boolean; status_code: number; method: string; route: string; target_id: string | null; target_name: string | null; details: any; ip: string | null }
interface Page { director: { id: string; name: string }; day: string; count: number; categories: Record<string, number>; entries: Entry[] }

const lagosToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date())   // YYYY-MM-DD
const shift = (iso: string, d: number) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10) }
const niceDay = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const ago = (iso: string | null) => {
  if (!iso) return 'No activity yet'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 1 ? 'Active just now' : m < 60 ? `Last active ${m} min ago` : m < 1440 ? `Last active ${Math.round(m / 60)} h ago` : `Last active ${Math.round(m / 1440)} d ago`
}

/* ───────── The shelf: one book per director ───────── */
function Shelf() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['journal-directors'], queryFn: async () => (await api.get<{ today: string; directors: Cover[] }>('/director-journal/directors')).data, refetchInterval: 30_000 })
  return (
    <div className="flex min-h-dvh flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full border border-green-100 bg-white dark:border-night-500 dark:bg-night-700"><ArrowLeft className="h-4 w-4 text-green-700 dark:text-night-100" /></button>
        <div><h1 className="text-lg font-extrabold text-green-900 dark:text-white">Director Journal</h1><p className="text-xs text-green-500 dark:text-night-300">Everything every director does is written here, automatically.</p></div>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-safe-nav pt-2">
        {isLoading && [0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-green-100 dark:bg-night-600" />)}
        {data?.directors.map((d, i) => (
          <motion.button key={d.id} onClick={() => navigate(`/director/journal/${d.id}`)}
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.35, ease: EASE_OUT }} whileTap={{ scale: 0.98 }}
            className="relative block w-full overflow-hidden rounded-r-2xl rounded-l-md text-left shadow-xl" style={{ background: 'linear-gradient(135deg,#3b2415 0%,#5a3a22 55%,#3b2415 100%)' }}>
            <span className="absolute inset-y-0 left-0 w-4" style={{ background: 'linear-gradient(90deg,#1f1209,#4a2f1b)' }} />
            <span className="absolute inset-y-3 left-6 w-px bg-amber-300/30" />
            <div className="relative px-9 py-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-amber-300/80">MonieKing · Journal</p>
                  <h2 className="mt-1 truncate font-serif text-2xl font-bold text-amber-50">{d.name}{d.is_me ? ' (you)' : ''}</h2>
                  <p className="mt-0.5 text-xs capitalize text-amber-100/70">{d.role}</p>
                </div>
                <BookOpen className="h-8 w-8 shrink-0 text-amber-300/80" />
              </div>
              <div className="mt-5 flex items-end justify-between">
                <div><p className="text-3xl font-extrabold text-amber-300">{d.actions_today}</p><p className="text-[11px] text-amber-100/70">actions today · {d.actions_total} in total</p><p className="mt-1 text-[11px] text-amber-100/50">{ago(d.last_action_at)}</p></div>
                <span className="rounded-full bg-amber-300 px-4 py-2 text-xs font-extrabold text-[#3b2415]">Open Journal</span>
              </div>
            </div>
          </motion.button>
        ))}
        {data && data.directors.length === 0 && <p className="py-10 text-center text-sm text-green-600">No directors found.</p>}
      </div>
    </div>
  )
}

/* ───────── An open book: one page per day ───────── */
function Book({ directorId }: { directorId: string }) {
  const navigate = useNavigate()
  const goBack = useGoBack('/director/journal')
  const today = lagosToday()
  const [day, setDay] = useState(today)
  const [dir, setDir] = useState(1)
  const [cat, setCat] = useState<string | null>(null)
  const [sensitive, setSensitive] = useState(false)
  const [q, setQ] = useState('')
  const [cal, setCal] = useState(false)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [open, setOpen] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['journal-day', directorId, day, cat, sensitive, q],
    queryFn: async () => (await api.get<Page>(`/director-journal/${directorId}`, { params: { day, category: cat || undefined, sensitive_only: sensitive || undefined, q: q.trim() || undefined } })).data,
    refetchInterval: day === today ? 20_000 : false,
  })
  const { data: calData } = useQuery({
    queryKey: ['journal-cal', directorId, month], enabled: cal,
    queryFn: async () => (await api.get<{ days: Record<string, number> }>(`/director-journal/${directorId}/calendar`, { params: { month } })).data,
  })
  const go = (d: string) => { if (d > today) return; setDir(d > day ? 1 : -1); setDay(d); setOpen(null) }
  const cats = useMemo(() => Object.entries(data?.categories ?? {}).sort((a, b) => b[1] - a[1]), [data])
  const grid = useMemo(() => {
    const [y, m] = month.split('-').map(Number) as [number, number]
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)] as (string | null)[]
  }, [month])

  return (
    <div className="flex min-h-dvh flex-col" style={{ background: 'linear-gradient(180deg,#2b1a0f,#3b2415)' }}>
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={goBack} aria-label="Back to the shelf" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10"><ArrowLeft className="h-4 w-4 text-amber-100" /></button>
        <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[0.25em] text-amber-300/70">Journal of</p><h1 className="truncate font-serif text-xl font-bold text-amber-50">{data?.director.name ?? '…'}</h1></div>
        <button onClick={() => setCal((v) => !v)} aria-label="Pick a day" className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-300 text-[#3b2415]"><CalendarDays className="h-4 w-4" /></button>
      </header>

      <div className="relative mx-3 flex-1 overflow-y-auto rounded-t-2xl pb-safe-nav" style={{ perspective: 1400 }}>
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.section key={day} custom={dir}
            initial={{ rotateY: dir * 16, opacity: 0, x: dir * 30 }} animate={{ rotateY: 0, opacity: 1, x: 0 }} exit={{ rotateY: -dir * 16, opacity: 0, x: -dir * 30 }}
            transition={{ duration: 0.28, ease: EASE_OUT }} style={{ transformOrigin: dir > 0 ? 'left center' : 'right center' }}
            className="min-h-full rounded-t-2xl bg-[#fbf6e9] shadow-2xl dark:bg-[#1f1b14]">
            {/* paper header with the date and day arrows */}
            <div className="flex items-center justify-between border-b-2 border-[#d9c9a3] px-3 py-3 dark:border-[#4a3f2a]">
              <button onClick={() => go(shift(day, -1))} aria-label="Previous day" className="flex h-9 w-9 items-center justify-center rounded-full text-[#5a3a22] active:bg-black/5 dark:text-amber-200"><ChevronLeft className="h-5 w-5" /></button>
              <div className="text-center"><p className="font-serif text-base font-bold text-[#2b2118] dark:text-amber-50">{niceDay(day)}</p><p className="text-[11px] text-[#8a7650] dark:text-amber-200/60">{day === today ? 'Today · ' : ''}{data ? `${data.count} ${data.count === 1 ? 'entry' : 'entries'}` : ' '}</p></div>
              <button onClick={() => go(shift(day, 1))} disabled={day >= today} aria-label="Next day" className="flex h-9 w-9 items-center justify-center rounded-full text-[#5a3a22] active:bg-black/5 disabled:opacity-25 dark:text-amber-200"><ChevronRight className="h-5 w-5" /></button>
            </div>

            {/* filters */}
            <div className="space-y-2 border-b border-[#e6d9b8] px-3 py-2.5 dark:border-[#3a3222]">
              <div className="flex items-center gap-2 rounded-xl border border-[#d9c9a3] bg-white/60 px-3 dark:border-[#4a3f2a] dark:bg-black/20">
                <Search className="h-4 w-4 text-[#8a7650]" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this day (action or customer)" className="w-full bg-transparent py-2 text-sm text-[#2b2118] outline-none placeholder:text-[#a8976f] dark:text-amber-50" />
                {q && <button onClick={() => setQ('')} aria-label="Clear"><X className="h-4 w-4 text-[#8a7650]" /></button>}
              </div>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                <Chip on={sensitive} onClick={() => setSensitive((v) => !v)}><ShieldAlert className="mr-1 inline h-3 w-3" />Sensitive</Chip>
                <Chip on={!cat} onClick={() => setCat(null)}>All</Chip>
                {cats.map(([c, n]) => <Chip key={c} on={cat === c} onClick={() => setCat(cat === c ? null : c)}>{c.replace(/_/g, ' ')} · {n}</Chip>)}
              </div>
            </div>

            {/* ruled page with a red margin line */}
            <div className="relative px-3 pb-10 pt-2" style={{ backgroundImage: 'repeating-linear-gradient(transparent 0, transparent 31px, rgba(120,95,50,0.12) 31px, rgba(120,95,50,0.12) 32px)' }}>
              <span className="pointer-events-none absolute inset-y-0 left-[4.6rem] w-px bg-red-400/40" />
              {isLoading && <p className="py-10 text-center text-sm text-[#8a7650]">Turning the page…</p>}
              {isError && <div className="py-10 text-center"><p className="text-sm text-red-600">Could not load this page.</p><button onClick={() => refetch()} className="mt-2 text-sm font-bold text-[#5a3a22] underline">Try again</button></div>}
              {data && data.entries.length === 0 && <p className="py-14 text-center font-serif text-base italic text-[#a8976f]">A blank page. Nothing was done {day === today ? 'yet today' : 'on this day'}.</p>}
              <ul>
                {data?.entries.map((e) => (
                  <li key={e.id} className="relative">
                    <button onClick={() => setOpen(open === e.id ? null : e.id)} className="flex w-full items-start gap-3 py-2 text-left">
                      <span className="w-14 shrink-0 pt-0.5 text-right font-mono text-[11px] font-bold text-[#8a7650] dark:text-amber-200/70">{e.time.slice(0, 5)}<span className="block text-[9px] font-normal opacity-70">{e.time.slice(6)}s</span></span>
                      <span className="min-w-0 flex-1 pl-2">
                        <span className={cn('block font-serif text-[15px] font-bold leading-snug text-[#2b2118] dark:text-amber-50', !e.ok && 'text-red-700 dark:text-red-300')}>{e.label}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#7a6845] dark:text-amber-200/60">
                          {e.target_name && <span className="font-semibold">→ {e.target_name}</span>}
                          {e.sensitive && <span className="rounded bg-red-100 px-1.5 py-px text-[9px] font-extrabold uppercase text-red-700">sensitive</span>}
                          {!e.ok && <span className="rounded bg-red-600 px-1.5 py-px text-[9px] font-extrabold uppercase text-white">failed</span>}
                          <span className="rounded bg-[#e9dcb9] px-1.5 py-px text-[9px] font-bold uppercase text-[#5a3a22]">{e.category.replace(/_/g, ' ')}</span>
                        </span>
                      </span>
                      <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-[#a8976f] transition-transform', open === e.id && 'rotate-180')} />
                    </button>
                    <AnimatePresence initial={false}>
                      {open === e.id && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="mb-2 ml-[4.6rem] rounded-lg border border-[#e0d1ab] bg-white/70 p-2.5 text-[11px] text-[#4a3f2a] dark:border-[#4a3f2a] dark:bg-black/30 dark:text-amber-100">
                            <p><b>{e.method}</b> {e.route} · status {e.status_code}{e.ip ? ` · ${e.ip}` : ''}</p>
                            {e.details?.body && <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px]">{JSON.stringify(e.details.body, null, 2)}</pre>}
                            {e.details?.query && <p className="mt-1 font-mono text-[10px]">?{e.details.query}</p>}
                            {e.target_id && <button onClick={() => navigate(`/director/customers/${e.target_id}`)} className="mt-2 font-bold text-[#5a3a22] underline dark:text-amber-200">Open this person</button>}
                            <p className="mt-1 text-[10px] opacity-60">Passwords, PINs and codes are never stored here.</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                ))}
              </ul>
            </div>
          </motion.section>
        </AnimatePresence>
      </div>

      {/* month calendar: days with writing on them are marked */}
      <AnimatePresence>
        {cal && (
          <motion.div className="fixed inset-0 z-[80] flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setCal(false)} />
            <motion.div role="dialog" aria-label="Pick a day" initial={{ y: 60 }} animate={{ y: 0 }} exit={{ y: 60 }} className="relative w-full max-w-md rounded-t-3xl bg-[#fbf6e9] p-5 pb-8 dark:bg-[#1f1b14]">
              <div className="mb-3 flex items-center justify-between">
                <button onClick={() => setMonth(shift(month + '-15', -30).slice(0, 7))} aria-label="Previous month" className="p-2 text-[#5a3a22] dark:text-amber-200"><ChevronLeft className="h-5 w-5" /></button>
                <p className="font-serif text-lg font-bold text-[#2b2118] dark:text-amber-50">{new Date(month + '-15T12:00:00Z').toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
                <button onClick={() => setMonth(shift(month + '-15', 30).slice(0, 7))} disabled={month >= today.slice(0, 7)} aria-label="Next month" className="p-2 text-[#5a3a22] disabled:opacity-25 dark:text-amber-200"><ChevronRight className="h-5 w-5" /></button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-[#a8976f]">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {grid.map((d, i) => d ? (
                  <button key={d} disabled={d > today} onClick={() => { go(d); setCal(false) }}
                    className={cn('relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm font-bold disabled:opacity-25', d === day ? 'bg-[#3b2415] text-amber-100' : 'text-[#2b2118] active:bg-black/5 dark:text-amber-50')}>
                    {Number(d.slice(8))}{calData?.days[d] ? <span className={cn('absolute bottom-1 h-1.5 w-1.5 rounded-full', d === day ? 'bg-amber-300' : 'bg-amber-600')} title={`${calData.days[d]} actions`} /> : null}
                  </button>
                ) : <span key={`b${i}`} />)}
              </div>
              <p className="mt-3 text-center text-[11px] text-[#8a7650]">A dot means something was written on that day.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className={cn('shrink-0 rounded-full border px-3 py-1 text-[11px] font-bold capitalize', on ? 'border-[#3b2415] bg-[#3b2415] text-amber-100' : 'border-[#d9c9a3] bg-white/60 text-[#5a3a22] dark:border-[#4a3f2a] dark:bg-black/20 dark:text-amber-200')}>{children}</button>
}

export default function JournalPage() {
  const { directorId } = useParams<{ directorId?: string }>()
  return directorId ? <Book directorId={directorId} /> : <Shelf />
}
