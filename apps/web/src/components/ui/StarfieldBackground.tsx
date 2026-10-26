import { useEffect, useRef } from 'react'

interface Star {
  x: number
  y: number
  radius: number
  baseOpacity: number
  twinkleSpeed: number
  twinklePhase: number
}

interface StarfieldBackgroundProps {
  starCount?: number
  constellationDistance?: number
  className?: string
}

/**
 * Twinkling stars with faint constellation lines connecting nearby ones —
 * the dark-mode "come to life" background for auth screens. Pure canvas,
 * no dependencies, respects prefers-reduced-motion.
 */
export function StarfieldBackground({ starCount = 90, constellationDistance = 110, className }: StarfieldBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0, height = 0, dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    let stars: Star[] = []
    let animationFrame = 0
    let time = 0
    let last = 0
    // The faint constellation lines never move, so they are drawn ONCE onto this layer
    // and simply copied each frame (instead of re-measuring thousands of pairs 60x a second).
    const lines = document.createElement('canvas')

    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      lines.width = canvas.width
      lines.height = canvas.height

      const count = Math.min(starCount, Math.floor((width * height) / 6000))
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.3 + 0.4,
        baseOpacity: Math.random() * 0.5 + 0.35,
        twinkleSpeed: Math.random() * 0.015 + 0.005,
        twinklePhase: Math.random() * Math.PI * 2,
      }))

      const lctx = lines.getContext('2d')
      if (lctx) {
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        lctx.clearRect(0, 0, width, height)
        lctx.lineWidth = 0.6
        for (let i = 0; i < stars.length; i++) {
          for (let j = i + 1; j < stars.length; j++) {
            const dx = stars[i].x - stars[j].x
            const dy = stars[i].y - stars[j].y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < constellationDistance) {
              lctx.strokeStyle = `rgba(167, 243, 208, ${(1 - dist / constellationDistance) * 0.15})`
              lctx.beginPath()
              lctx.moveTo(stars[i].x, stars[i].y)
              lctx.lineTo(stars[j].x, stars[j].y)
              lctx.stroke()
            }
          }
        }
      }
    }

    const draw = (now = 0) => {
      // ~30 frames a second is plenty for twinkling, and leaves the GPU free for the page's own animations
      if (!prefersReducedMotion && now - last < 33) { animationFrame = requestAnimationFrame(draw); return }
      last = now
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(lines, 0, 0)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      for (const star of stars) {
        const twinkle = prefersReducedMotion
          ? star.baseOpacity
          : star.baseOpacity + Math.sin(time * star.twinkleSpeed + star.twinklePhase) * 0.3
        ctx.beginPath()
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0.1, Math.min(1, twinkle))})`
        ctx.fill()
      }

      time += 2
      if (!prefersReducedMotion && !document.hidden) animationFrame = requestAnimationFrame(draw)
    }

    const onVisible = () => { if (!document.hidden && !prefersReducedMotion) { cancelAnimationFrame(animationFrame); animationFrame = requestAnimationFrame(draw) } }

    resize()
    draw()

    const handleResize = () => { resize() }
    window.addEventListener('resize', handleResize)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('visibilitychange', onVisible)
      if (animationFrame) cancelAnimationFrame(animationFrame)
    }
  }, [starCount, constellationDistance])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  )
}
