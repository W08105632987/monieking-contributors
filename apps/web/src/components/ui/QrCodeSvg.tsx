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

  const cells: { r: number; c: number }[] = []
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (qr.modules.get(r, c)) {
        cells.push({ r, c })
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`bg-white rounded-2xl ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="QR Code"
    >
      {/* White quiet zone background */}
      <rect width={size} height={size} fill="white" rx={12} />
      {cells.map(({ r, c }) => (
        <rect
          key={`${r}-${c}`}
          x={offset + c * cellSize}
          y={offset + r * cellSize}
          width={cellSize + 0.3}
          height={cellSize + 0.3}
          fill="#062F16"
        />
      ))}
    </svg>
  )
}
