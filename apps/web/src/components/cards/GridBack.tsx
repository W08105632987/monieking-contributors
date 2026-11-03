import { Maximize2 } from 'lucide-react'
import type { GridCell } from '@/types'
import { cn, MONTH_NAMES } from '@/lib/utils'

export type CellGrid = (GridCell | undefined)[][]

const tone = (c: GridCell | undefined) => (c?.withdrawn ? 'bg-red-400' : c?.filled ? 'bg-green-600 dark:bg-green-500' : 'bg-green-100 dark:bg-night-500')

export function gridCounts(grid: CellGrid) {
  let filled = 0, withdrawn = 0
  const perMonth = grid.map((row) => row.reduce((n, c) => { if (c?.withdrawn) withdrawn++; else if (c?.filled) { filled++ } return n + (c?.filled || c?.withdrawn ? 1 : 0) }, 0))
  return { filled, withdrawn, perMonth }
}

/** The whole 12 x 31 grid in one view: no scrolling. `large` = the roomy version used in the full-screen sheet. */
export function GridView({ grid, large = false }: { grid: CellGrid; large?: boolean }) {
  const { perMonth } = gridCounts(grid)
  return (
    <div className="w-full" style={{ display: 'grid', gridTemplateColumns: `${large ? 30 : 22}px repeat(31, minmax(0, 1fr))${large ? ' 28px' : ''}`, gap: large ? 3 : 2 }}>
      <span />
      {Array.from({ length: 31 }, (_, i) => (
        <span key={i} className="text-center text-green-500 dark:text-night-200" style={{ fontSize: large ? 7 : 5, lineHeight: large ? '10px' : '7px' }}>{i + 1}</span>
      ))}
      {large && <span />}
      {MONTH_NAMES.map((month, m) => (
        <div key={m} style={{ display: 'contents' }}>
          <span className="self-center text-right font-semibold text-green-700 dark:text-night-100" style={{ fontSize: large ? 9 : 6 }}>{month}</span>
          {Array.from({ length: 31 }, (_, d) => (
            <span key={d} className={cn('rounded-[2px]', tone(grid[m]?.[d]))} style={large ? { height: 16 } : { aspectRatio: '1' }} />
          ))}
          {large && <span className="self-center text-right font-bold text-green-800 dark:text-night-100" style={{ fontSize: 9 }}>{perMonth[m]}</span>}
        </div>
      ))}
    </div>
  )
}

/** Content for the back of a flip card. */
export function GridBack({ grid, onExpand }: { grid: CellGrid; onExpand: () => void }) {
  return (
    <div className="flex h-full w-full flex-col p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-night-100">Contribution grid</p>
        <button type="button" onClick={(e) => { e.stopPropagation(); onExpand() }}
          className="flex items-center gap-1 rounded-full bg-green-700 px-2.5 py-1 text-[10px] font-bold text-white active:scale-95 dark:bg-night-400">
          <Maximize2 className="h-3 w-3" /> Full view
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="w-full" style={{ maxWidth: 380 }}><GridView grid={grid} /></div>
      </div>
      <p className="mt-1 text-center text-[9px] text-green-500 dark:text-night-300">Tap the card to flip back</p>
    </div>
  )
}
