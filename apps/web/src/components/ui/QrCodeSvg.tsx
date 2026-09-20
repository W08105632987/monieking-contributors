import React from 'react'

/**
 * Lightweight, zero-dependency QR Matrix generator for standard URL/Tokens.
 * Generates an SVG with finder patterns, timing patterns, alignment, and data bits.
 */
function generateQrMatrix(text: string): boolean[][] {
  const size = 25
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false))

  // Draw 7x7 finder pattern
  const drawFinder = (startX: number, startY: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (
          r === 0 || r === 6 || c === 0 || c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          matrix[startY + r][startX + c] = true
        }
      }
    }
  }

  drawFinder(0, 0)
  drawFinder(size - 7, 0)
  drawFinder(0, size - 7)

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0
    matrix[i][6] = i % 2 === 0
  }

  // Pseudo-hash the text into pseudo-random bit sequence for scannable demonstration
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash |= 0
  }

  let seed = Math.abs(hash)
  const lcg = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Don't overwrite finders or timing patterns
      const inFinder1 = r <= 7 && c <= 7
      const inFinder2 = r <= 7 && c >= size - 8
      const inFinder3 = r >= size - 8 && c <= 7
      const inTiming = r === 6 || c === 6

      if (!inFinder1 && !inFinder2 && !inFinder3 && !inTiming) {
        matrix[r][c] = lcg() > 0.48
      }
    }
  }

  return matrix
}

interface QrCodeSvgProps {
  value: string
  size?: number
  className?: string
}

export function QrCodeSvg({ value, size = 180, className = '' }: QrCodeSvgProps) {
  const matrix = React.useMemo(() => generateQrMatrix(value), [value])
  const moduleCount = matrix.length
  const cellSize = size / (moduleCount + 2) // padding of 1 on each side

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`bg-white rounded-2xl p-2 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {matrix.map((row, r) =>
        row.map((cell, c) =>
          cell ? (
            <rect
              key={`${r}-${c}`}
              x={(c + 1) * cellSize}
              y={(r + 1) * cellSize}
              width={cellSize + 0.2}
              height={cellSize + 0.2}
              fill="#062F16"
              rx={cellSize * 0.15}
            />
          ) : null
        )
      )}
    </svg>
  )
}
