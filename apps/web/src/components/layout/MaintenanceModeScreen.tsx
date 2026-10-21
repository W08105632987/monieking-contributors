import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Clock, RefreshCw, ShieldCheck, Wrench } from 'lucide-react'
import { useMaintenanceStore } from '@/store/maintenance.store'
import { api } from '@/lib/api'

const left = (eta: string | null, now: number) => {
  if (!eta) return null
  const ms = new Date(eta).getTime() - now
  if (!isFinite(ms)) return null
  if (ms <= 0) return 'any moment now'
  const m = Math.ceil(ms / 60000)
  return m >= 60 ? `about ${Math.floor(m / 60)}h ${m % 60}m` : `about ${m} min`
}

function Gear({ size, x, y, dur, rev, tone }: { size: number; x: number; y: number; dur: number; rev?: boolean; tone: string }) {
  return (
    <motion.svg viewBox="0 0 100 100" width={size} height={size} style={{ position: 'absolute', left: x, top: y }}
      animate={{ rotate: rev ? -360 : 360 }} transition={{ repeat: Infinity, duration: dur, ease: 'linear' }} aria-hidden>
      <path fill={tone} d="M50 8l6 10a32 32 0 0 1 10 4l11-4 7 12-8 8a32 32 0 0 1 0 12l8 8-7 12-11-4a32 32 0 0 1-10 4l-6 10H44l-6-10a32 32 0 0 1-10-4l-11 4-7-12 8-8a32 32 0 0 1 0-12l-8-8 7-12 11 4a32 32 0 0 1 10-4l6-10zm0 26a16 16 0 1 0 0 32 16 16 0 0 0 0-32z" />
    </motion.svg>
  )
}

/** Shown to customers, officers and service workers while directors have maintenance switched on. */
export function MaintenanceModeScreen() {
  const { message, eta, startedAt } = useMaintenanceStore()
  const [now, setNow] = useState(Date.now())
  const [checking, setChecking] = useState(false)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t) }, [])
  const check = async () => {
    setChecking(true)
    try { const r = await api.get('/maintenance'); useMaintenanceStore.getState().set({ on: r.data.on, message: r.data.message, eta: r.data.eta, startedAt: r.data.started_at }) } catch { /* keep waiting */ }
    finally { setChecking(false) }
  }
  const eta_text = left(eta, now)
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-green-900 via-green-800 to-green-950 px-6 text-center text-white">
      <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #34d399 0, transparent 40%), radial-gradient(circle at 85% 80%, #fbbf24 0, transparent 35%)' }} />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative z-10 flex flex-col items-center">
        <div className="relative mb-8 h-44 w-52">
          <Gear size={110} x={20} y={30} dur={14} tone="#34d399" />
          <Gear size={70} x={112} y={8} dur={9} rev tone="#fbbf24" />
          <Gear size={52} x={118} y={92} dur={7} tone="#a7f3d0" />
          <motion.div className="absolute left-[78px] top-[68px] flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-green-900 shadow-xl"
            animate={{ rotate: [0, -18, 14, 0] }} transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}><Wrench className="h-6 w-6" /></motion.div>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">We are undergoing maintenance</h1>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-green-100">{message}</p>
        <div className="mt-6 w-64">
          <div className="h-2 overflow-hidden rounded-full bg-white/15">
            <motion.div className="h-full w-1/3 rounded-full bg-gradient-to-r from-amber-300 to-emerald-300" animate={{ x: ['-100%', '300%'] }} transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }} />
          </div>
          {eta_text && <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-200"><Clock className="h-3.5 w-3.5" />Back in {eta_text}</p>}
          {!eta_text && startedAt && <p className="mt-3 text-xs text-green-200">Started {new Date(startedAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}</p>}
        </div>
        <div className="mt-6 flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2.5 text-xs text-green-50 backdrop-blur"><ShieldCheck className="h-4 w-4 flex-shrink-0 text-emerald-300" />Your money, cards and contributions are safe. Nothing is lost.</div>
        <button onClick={check} disabled={checking} className="mt-6 flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-extrabold text-green-900 shadow-lg active:scale-95 disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />{checking ? 'Checking…' : 'Check again'}
        </button>
        <p className="mt-2 text-[11px] text-green-300">We also check automatically.</p>
        <Link to="/auth/login" className="mt-8 text-[11px] font-semibold text-green-300 underline">Staff sign in</Link>
      </motion.div>
    </div>
  )
}
