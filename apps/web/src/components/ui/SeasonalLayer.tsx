import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSeason } from '@/hooks/useSeasonal'
import { seasonGreeting, type ActiveSeason } from '@/lib/seasonal'
import { useAuthStore } from '@/store/auth.store'
import { playJingle, shouldPlayJingle, markJinglePlayed } from '@/lib/jingle'
import { SeasonalArt } from '@/components/ui/SeasonalArt'
import '@/styles/seasonal.css'

const rnd = (i: number, k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1 // stable pseudo-random 0..1

const BULB_COLORS = ['#ef4444', '#facc15', '#22c55e', '#38bdf8', '#f472b6']
const CONFETTI_COLORS = ['#facc15', '#f472b6', '#38bdf8', '#34d399', '#fb923c', '#a78bfa']
const BURST_COLORS = ['#facc15', '#f87171', '#60a5fa', '#34d399', '#f472b6']
const EGG_COLORS = [['#fbcfe8', '#f472b6'], ['#bae6fd', '#38bdf8'], ['#fef08a', '#facc15'], ['#bbf7d0', '#4ade80'], ['#ddd6fe', '#a78bfa']]

function Fall({ n, render, cls, size = [10, 22], dur = [12, 22] }: {
  n: number; cls: string; size?: [number, number]; dur?: [number, number]
  render: (i: number, px: number) => React.ReactNode
}) {
  const items = useMemo(() => Array.from({ length: n }, (_, i) => ({
    left: rnd(i, 1) * 100,
    px: size[0] + rnd(i, 2) * (size[1] - size[0]),
    delay: -rnd(i, 3) * dur[1],
    duration: dur[0] + rnd(i, 4) * (dur[1] - dur[0]),
    drift: (rnd(i, 5) > 0.5 ? 1 : -1) * (15 + rnd(i, 6) * 45),
    o: 0.5 + rnd(i, 7) * 0.45,
  })), [n]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {items.map((p, i) => (
        <span key={i} className={`mk-p mk-moving ${cls}`}
          style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, ['--drift' as string]: `${p.drift}px`, ['--o' as string]: p.o }}>
          {render(i, p.px)}
        </span>
      ))}
    </>
  )
}

function Lights() {
  const count = 14
  return (
    <svg aria-hidden="true" className="mk-lights" viewBox="0 0 400 44" preserveAspectRatio="none">
      <path d="M0 4 Q 50 30 100 8 T 200 8 T 300 8 T 400 6" fill="none" stroke="#14532d" strokeWidth="1.6" />
      {Array.from({ length: count }, (_, i) => {
        const x = (i + 0.5) * (400 / count)
        const y = 8 + 12 * Math.abs(Math.sin((i + 0.5) * Math.PI / 3.5)) * 0.9
        const c = BULB_COLORS[i % BULB_COLORS.length]
        return (
          <g key={i} className="mk-bulb" style={{ animationDelay: `${(i % 5) * 0.45}s`, color: c }}>
            <line x1={x} y1={y - 4} x2={x} y2={y} stroke="#14532d" strokeWidth="1.2" />
            <ellipse cx={x} cy={y + 4.5} rx="3" ry="4.2" fill={c} />
            <ellipse cx={x} cy={y + 4.5} rx="6" ry="7" fill={c} opacity=".18" />
          </g>
        )
      })}
    </svg>
  )
}

function Snowflake({ px }: { px: number }) {
  return px > 17
    ? <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 3px rgba(255,255,255,.8))' }}>
        <path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2" />
      </svg>
    : <span className="mk-flake" style={{ width: px / 2.4, height: px / 2.4 }} />
}

function Christmas() {
  return (
    <>
      <Lights />
      <Fall n={22} cls="mk-snow" size={[8, 22]} dur={[12, 22]} render={(_, px) => <Snowflake px={px} />} />
      <Fall n={4} cls="mk-float" size={[18, 26]} dur={[18, 28]} render={(i, px) => <span style={{ fontSize: px }}>{['🎁', '⭐', '🔔', '🎄'][i % 4]}</span>} />
    </>
  )
}

function Bursts() {
  const bursts = [
    { x: 22, y: 24, d: 0 }, { x: 74, y: 18, d: 1.1 }, { x: 48, y: 34, d: 2.0 },
  ]
  const RAYS = 12
  return (
    <>
      {bursts.map((b, bi) => (
        <div key={bi} className="mk-burst mk-moving" style={{ left: `${b.x}%`, top: `${b.y}%` }}>
          {Array.from({ length: RAYS }, (_, r) => {
            const a = (r / RAYS) * Math.PI * 2
            const dist = 46 + rnd(bi * 20 + r, 9) * 26
            return (
              <span key={r} className="mk-ray"
                style={{ ['--dx' as string]: `${Math.cos(a) * dist}px`, ['--dy' as string]: `${Math.sin(a) * dist}px`, ['--c' as string]: BURST_COLORS[(bi + r) % BURST_COLORS.length], ['--d' as string]: `${b.d}s` }} />
            )
          })}
        </div>
      ))}
    </>
  )
}

function NewYear() {
  return (
    <>
      <Bursts />
      <Fall n={26} cls="mk-confetti" size={[1, 1]} dur={[7, 14]}
        render={(i) => <span className="mk-conf" style={{ background: CONFETTI_COLORS[i % CONFETTI_COLORS.length], transform: `scale(${0.7 + rnd(i, 8) * 0.6})` }} />} />
    </>
  )
}

function Egg({ px, i }: { px: number; i: number }) {
  const [a, b] = EGG_COLORS[i % EGG_COLORS.length]
  return (
    <svg width={px} height={px * 1.25} viewBox="0 0 24 30">
      <path d="M12 1C6 1 2 12 2 19a10 10 0 0 0 20 0C22 12 18 1 12 1z" fill={a} />
      <path d="M3 17l3-3 3 3 3-3 3 3 3-3 3 3" fill="none" stroke={b} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="12" cy="23" r="2" fill={b} />
    </svg>
  )
}

function Bunting() {
  const flags = 12
  return (
    <svg aria-hidden="true" className="mk-bunting" viewBox="0 0 400 44" preserveAspectRatio="none">
      <path d="M0 4 Q 100 22 200 6 T 400 4" fill="none" stroke="#a16207" strokeWidth="1.4" />
      {Array.from({ length: flags }, (_, i) => {
        const x = 12 + i * (376 / (flags - 1))
        const y = 8 + 8 * Math.sin((i / (flags - 1)) * Math.PI)
        const c = EGG_COLORS[i % EGG_COLORS.length][1]
        return <path key={i} d={`M${x - 8} ${y} L${x + 8} ${y} L${x} ${y + 17} Z`} fill={c} opacity=".9" />
      })}
    </svg>
  )
}

function Easter() {
  return (
    <>
      <Bunting />
      <Fall n={9} cls="mk-float" size={[14, 22]} dur={[16, 26]} render={(i, px) => <Egg px={px} i={i} />} />
      <Fall n={5} cls="mk-float" size={[16, 24]} dur={[18, 28]} render={(i, px) => <span style={{ fontSize: px }}>{['🌷', '🐣', '🌼', '🐰', '🌸'][i % 5]}</span>} />
    </>
  )
}

const ART: Record<ActiveSeason, () => JSX.Element> = { christmas: Christmas, newyear: NewYear, easter: Easter }

/** Light, non-blocking seasonal decoration over the whole app + a one-time greeting per session. */
export function SeasonalLayer() {
  const season = useSeason()
  const [greet, setGreet] = useState(false)
  const userId = useAuthStore((s) => (s.isAuthenticated ? s.user?.id : undefined))

  // First login while the Christmas theme is on: one short jingle, once per person per year. If the browser
  // refuses sound until the person touches the screen, wait for that first tap and try again.
  useEffect(() => {
    if (season !== 'christmas' || !userId) return
    const year = new Date().getFullYear()
    if (!shouldPlayJingle(userId, year)) return
    let cancelled = false
    const attempt = async () => {
      if (cancelled) return
      if (await playJingle()) { markJinglePlayed(userId, year); cleanup() }
    }
    const cleanup = () => { window.removeEventListener('pointerdown', attempt); window.removeEventListener('keydown', attempt) }
    void attempt()
    window.addEventListener('pointerdown', attempt)
    window.addEventListener('keydown', attempt)
    return () => { cancelled = true; cleanup() }
  }, [season, userId])

  useEffect(() => {
    if (!season) return
    let seen = false
    try { seen = sessionStorage.getItem(`mk-season-${season}`) === '1'; sessionStorage.setItem(`mk-season-${season}`, '1') } catch { /* ignore */ }
    if (seen) return
    setGreet(true)
    const t = setTimeout(() => setGreet(false), 4500)
    return () => clearTimeout(t)
  }, [season])

  if (!season) return null
  const Scene = ART[season]

  return (
    <>
      <div aria-hidden="true" className="mk-season pointer-events-none fixed inset-0 z-[35] overflow-hidden">
        <Scene />
        <SeasonalArt slot="header" className="absolute left-0 top-0 w-full max-h-24 object-cover object-top" />
      </div>
      <AnimatePresence>
        {greet && (
          <motion.div
            initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="pointer-events-none fixed left-1/2 z-[9000] -translate-x-1/2 rounded-full border border-amber-300/60 bg-green-950/90 px-4 py-2 text-xs font-bold text-amber-200 shadow-lg backdrop-blur"
            style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
          >
            {seasonGreeting(season)}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
