import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, FlaskConical, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const pctText = (bps: number) => `${+(bps / 100).toFixed(2)}%`
export const dShort = (iso: string) =>
  new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
export const dDay = (iso: string) =>
  new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
export const nairaNum = (kobo: number) => new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(kobo / 100)
export const compactNaira = (kobo: number) => {
  const n = kobo / 100
  if (Math.abs(n) >= 1_000_000) return `₦${+(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `₦${+(n / 1_000).toFixed(1)}K`
  return `₦${n}`
}

export function TestBanner({ className }: { className?: string }) {
  return (
    <div className={cn('mx-4 mb-3 flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200', className)}>
      <FlaskConical className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <p><b>TEST MODE.</b> All money here is test money inside the cooperative's own records. No real wallet is touched.</p>
    </div>
  )
}

export function CoopPage({ title, subtitle, back, right, children, noBanner }: {
  title: string; subtitle?: string; back?: string | boolean; right?: ReactNode; children: ReactNode; noBanner?: boolean
}) {
  const navigate = useNavigate()
  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        {back && (
          <button
            onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
            className="h-9 w-9 flex-shrink-0 rounded-full border border-green-100 bg-white flex items-center justify-center dark:border-night-500 dark:bg-night-700"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4 text-green-700 dark:text-night-100" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-extrabold text-green-900 dark:text-white">{title}</h1>
          {subtitle && <p className="truncate text-xs text-green-600 dark:text-night-200">{subtitle}</p>}
        </div>
        {right}
      </header>
      {!noBanner && <TestBanner />}
      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">{children}</div>
    </div>
  )
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const Tag: any = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl border border-green-100 bg-white p-4 text-left shadow-card dark:border-night-500 dark:bg-night-700',
        onClick && 'active:scale-[0.99] transition-transform',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between">
      <h2 className="text-base font-bold text-green-900 dark:text-white">{children}</h2>
      {right}
    </div>
  )
}

const tones = {
  green: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  grey: 'bg-slate-100 text-slate-600 dark:bg-night-600 dark:text-night-200',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
} as const
export type Tone = keyof typeof tones

export function Pill({ tone = 'grey', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', tones[tone], className)}>{children}</span>
}

export function loanTone(status: string): { tone: Tone; label: string } {
  switch (status) {
    case 'seeking_guarantors': return { tone: 'amber', label: 'Finding guarantors' }
    case 'awaiting_approval': return { tone: 'blue', label: 'With the directors' }
    case 'repaying': return { tone: 'green', label: 'Repaying' }
    case 'repaid': return { tone: 'green', label: 'Repaid' }
    case 'rejected': return { tone: 'red', label: 'Not approved' }
    case 'cancelled': return { tone: 'grey', label: 'Cancelled' }
    case 'expired': return { tone: 'grey', label: 'Expired' }
    default: return { tone: 'grey', label: status }
  }
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-green-500 dark:text-night-300">{label}</p>
      <p className="truncate text-lg font-extrabold text-green-900 dark:text-white">{value}</p>
      {sub && <p className="text-[11px] text-green-600 dark:text-night-200">{sub}</p>}
    </div>
  )
}

export function Bar({ value, max = 100, tone = 'green' }: { value: number; max?: number; tone?: 'green' | 'amber' | 'blue' }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  const c = { green: 'bg-green-500', amber: 'bg-amber-400', blue: 'bg-blue-500' }[tone]
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-green-100 dark:bg-night-600">
      <motion.div className={cn('h-full rounded-full', c)} initial={false} animate={{ width: `${w}%` }} transition={{ type: 'spring', stiffness: 160, damping: 22 }} />
    </div>
  )
}

export function MoneyInput({ value, onChange, placeholder = '0', autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="flex items-center rounded-xl border border-green-200 bg-white px-3 focus-within:border-green-500 dark:border-night-400 dark:bg-night-800">
      <span className="mr-1 text-lg font-bold text-green-700 dark:text-night-100">₦</span>
      <input
        inputMode="numeric" autoFocus={autoFocus} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 11))}
        className="w-full bg-transparent py-3 text-lg font-bold text-green-900 outline-none placeholder:text-green-300 dark:text-white dark:placeholder:text-night-400"
      />
    </div>
  )
}
export const toKobo = (naira: string) => (naira ? Math.round(Number(naira) * 100) : 0)

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-green-800 dark:text-night-100">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-green-600 dark:text-night-200">{hint}</span>}
    </label>
  )
}

export const inputCls = 'w-full rounded-xl border border-green-200 bg-white px-3 py-3 text-sm text-green-900 outline-none focus:border-green-500 dark:border-night-400 dark:bg-night-800 dark:text-white'

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[60] bg-green-950/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog" aria-label={title}
            className="fixed inset-x-0 bottom-0 z-[61] mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 dark:bg-night-700"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-green-200 dark:bg-night-400" />
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold text-green-900 dark:text-white">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-green-600 dark:text-night-200"><X className="h-5 w-5" /></button>
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export function BigButton({ children, onClick, disabled, loading, tone = 'green', type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean; tone?: 'green' | 'amber' | 'red' | 'ghost'; type?: 'button' | 'submit'
}) {
  const cls = {
    green: 'bg-green-700 text-white hover:bg-green-800 dark:bg-green-600',
    amber: 'bg-amber-400 text-green-950 hover:bg-amber-300',
    red: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'border border-green-200 bg-white text-green-800 dark:border-night-400 dark:bg-night-700 dark:text-night-100',
  }[tone]
  return (
    <button
      type={type} onClick={onClick} disabled={disabled || loading}
      className={cn('flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-extrabold transition-all active:scale-[0.98] disabled:opacity-50', cls)}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  )
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100 text-green-700 dark:bg-night-600 dark:text-night-100">{icon}</div>
      <p className="font-extrabold text-green-900 dark:text-white">{title}</p>
      <p className="mt-1 text-sm text-green-600 dark:text-night-200">{text}</p>
      {action && <div className="mt-4 w-full max-w-xs">{action}</div>}
    </div>
  )
}

export function Skel({ h = 'h-24' }: { h?: string }) {
  return <div className={cn('animate-pulse rounded-2xl bg-green-100 dark:bg-night-600', h)} />
}

export function Provisional({ show = true }: { show?: boolean }) {
  return show ? <Pill tone="amber">Awaiting Board decision</Pill> : null
}

export function useCountdown(iso?: string | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])
  if (!iso) return ''
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return 'expired'
  const h = Math.floor(ms / 3_600_000)
  if (h >= 48) return `${Math.floor(h / 24)} days left`
  if (h >= 1) return `${h}h left`
  return `${Math.max(1, Math.floor(ms / 60_000))} min left`
}
