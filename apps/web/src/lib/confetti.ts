/** Dependency-free confetti burst on a throwaway full-screen canvas. */
const COLORS = ['#f59e0b', '#fbbf24', '#10b981', '#34d399', '#ffffff', '#ef4444', '#60a5fa']

export function fireConfetti(opts: { count?: number; duration?: number } = {}): void {
  if (typeof document === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const count = opts.count ?? 160
  const duration = opts.duration ?? 2600
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:10050'
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) { canvas.remove(); return }
  ctx.scale(dpr, dpr)
  const W = window.innerWidth
  const H = window.innerHeight

  const parts = Array.from({ length: count }, (_, i) => {
    const fromLeft = i % 2 === 0
    const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9
    const speed = 11 + Math.random() * 10
    return {
      x: fromLeft ? W * 0.1 : W * 0.9, y: H * 0.75,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 6, h: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      round: Math.random() < 0.3,
    }
  })

  const start = performance.now()
  const tick = (now: number) => {
    const t = now - start
    ctx.clearRect(0, 0, W, H)
    const fade = t > duration - 600 ? Math.max(0, (duration - t) / 600) : 1
    for (const p of parts) {
      p.vy += 0.32; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.rot += p.vr
      ctx.save()
      ctx.globalAlpha = fade
      ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill() }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }
    if (t < duration) requestAnimationFrame(tick)
    else canvas.remove()
  }
  requestAnimationFrame(tick)
}
