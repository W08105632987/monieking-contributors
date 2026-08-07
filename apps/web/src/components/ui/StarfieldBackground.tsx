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

    let width = 0, height = 0, dpr = Math.min(window.devicePixelRatio || 1, 2)
    let stars: Star[] = []
    let animationFrame: number
    let time = 0

    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.scale(dpr, dpr)

      const count = Math.min(starCount, Math.floor((width * height) / 6000))
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.3 + 0.4,
        baseOpacity: Math.random() * 0.5 + 0.35,
        twinkleSpeed: Math.random() * 0.015 + 0.005,
        twinklePhase: Math.random() * Math.PI * 2,
      }))
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)

      // Constellation lines between nearby stars
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const dx = stars[i].x - stars[j].x
          const dy = stars[i].y - stars[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < constellationDistance) {
            const opacity = (1 - dist / constellationDistance) * 0.15
            ctx.strokeStyle = `rgba(167, 243, 208, ${opacity})`
            ctx.lineWidth = 0.6
            ctx.beginPath()
            ctx.moveTo(stars[i].x, stars[i].y)
            ctx.lineTo(stars[j].x, stars[j].y)
            ctx.stroke()
          }
        }
      }

      // Twinkling stars
      for (const star of stars) {
        const twinkle = prefersReducedMotion
          ? star.baseOpacity
          : star.baseOpacity + Math.sin(time * star.twinkleSpeed + star.twinklePhase) * 0.3
        ctx.beginPath()
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0.1, Math.min(1, twinkle))})`
        ctx.fill()
      }

      time += 1
      if (!prefersReducedMotion) {
        animationFrame = requestAnimationFrame(draw)
      }
    }

    resize()
    draw()

    const handleResize = () => resize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
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
