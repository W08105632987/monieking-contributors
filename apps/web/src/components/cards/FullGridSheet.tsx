import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { sheetMotion, overlayMotion } from '@/lib/motion'
import { GridView, gridCounts, type CellGrid } from './GridBack'

/** Whole contribution grid in a roomy full-screen sheet, with totals. */
export function FullGridSheet({ open, onClose, grid, title }: { open: boolean; onClose: () => void; grid: CellGrid; title: string }) {
  const { filled, withdrawn } = gridCounts(grid)
  const empty = 372 - filled - withdrawn
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" onClick={onClose}>
          <motion.div {...overlayMotion} className="absolute inset-0 bg-green-950/60" />
          <motion.div {...sheetMotion} onClick={(e) => e.stopPropagation()}
            className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-4 pb-8 dark:bg-night-800">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-green-200 dark:bg-night-500" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-extrabold text-green-950 dark:text-white">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-green-50 dark:bg-night-600"><X className="h-4 w-4 text-green-700 dark:text-night-100" /></button>
            </div>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-green-50 p-2 dark:bg-night-700"><p className="text-lg font-extrabold text-green-700 dark:text-green-400">{filled}</p><p className="text-[10px] font-semibold text-green-600 dark:text-night-200">Filled</p></div>
              <div className="rounded-xl bg-red-50 p-2 dark:bg-red-950/30"><p className="text-lg font-extrabold text-red-500">{withdrawn}</p><p className="text-[10px] font-semibold text-red-500/80">Withdrawn</p></div>
              <div className="rounded-xl bg-green-50 p-2 dark:bg-night-700"><p className="text-lg font-extrabold text-green-900 dark:text-white">{empty}</p><p className="text-[10px] font-semibold text-green-600 dark:text-night-200">Empty</p></div>
            </div>
            <GridView grid={grid} large />
            <p className="mt-3 text-center text-[10px] text-green-500 dark:text-night-300">Numbers on the right are days used in each month.</p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
