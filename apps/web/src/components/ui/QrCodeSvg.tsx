import React from 'react'
import QRCode from 'qrcode'

interface QrCodeSvgProps {
  value: string
  size?: number
  className?: string
}

/**
 * Renders a real, ISO/IEC 18004-compliant QR code as an SVG.
 * Uses the official 'qrcode' package (spec-compliant data encoding & Reed-Solomon error correction).
 * The output is scannable by any standard QR reader / camera.
 */
export function QrCodeSvg({ value, size = 180, className = '' }: QrCodeSvgProps) {
  const qr = React.useMemo(() => {
    try {
      if (!value) return null
      return QRCode.create(value, { errorCorrectionLevel: 'M' })
    } catch {
      return null
    }
  }, [value])

  if (!qr) {
    return (
      <div
        className={`bg-white rounded-2xl flex items-center justify-center text-xs text-red-400 p-2 ${className}`}
        style={{ width: size, height: size }}
      >
        QR Error
      </div>
    )
  }

  const moduleCount = qr.modules.size
  // Quiet zone = 4 modules on each side (ISO spec)
  const totalModules = moduleCount + 8
  const cellSize = size / totalModules
  const offset = 4 * cellSize // quiet zone offset

  // Merge each horizontal run of dark modules into ONE rectangle inside a
  // single <path>. The old version emitted one <rect> per dark module (~440
  // DOM nodes), which made the modal's first paint heavy while it was
  // animating in. Same picture, a fraction of the nodes, and no hairline
  // seams between neighbouring modules.
  const pathD = React.useMemo(() => {
    let d = ''
    for (let r = 0; r < moduleCount; r++) {
      let c = 0
      while (c < moduleCount) {
        if (!qr.modules.get(r, c)) { c++; continue }
        const start = c
        while (c < moduleCount && qr.modules.get(r, c)) c++
        d += `M${offset + start * cellSize} ${offset + r * cellSize}h${(c - start) * cellSize}v${cellSize}h${-(c - start) * cellSize}z`
      }
    }
    return d
  }, [qr, moduleCount, cellSize, offset])

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`bg-white rounded-2xl ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="QR Code"
      shapeRendering="crispEdges"
    >
      {/* White quiet zone background */}
      <rect width={size} height={size} fill="white" rx={12} />
      <path d={pathD} fill="#062F16" />
    </svg>
  )
}
