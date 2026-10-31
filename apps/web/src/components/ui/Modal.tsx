import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence, useDragControls, type PanInfo } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useScrollLock } from '@/hooks/useScrollLock'
import { sheetMotion, overlayMotion, dialogMotion, willAnimate, SWIPE_DISMISS_OFFSET, SWIPE_DISMISS_VELOCITY } from '@/lib/motion'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeMap = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' }

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])'

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 768px)').matches : false,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 768px)')
    const on = () => setDesktop(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return desktop
}

export function Modal({ open, onClose, title, children, className, size = 'md' }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const desktop = useIsDesktop()
  // Dragging starts ONLY from the handle strip. Dragging the whole panel makes framer-motion set touch-action to
  // pan-x, which stops the sheet's own content from scrolling vertically on phones.
  const dragControls = useDragControls()
  useScrollLock(open)

  // Escape to close, focus trap, focus restore.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => {
      const el = panelRef.current
      if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true })
    })
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab') return
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!nodes || nodes.length === 0) return
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [open, onClose])

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > SWIPE_DISMISS_OFFSET || info.velocity.y > SWIPE_DISMISS_VELOCITY) onClose()
  }

  const motionProps = desktop ? dialogMotion : sheetMotion

  return (
    <AnimatePresence>
      {open && (
        <Fragment>
          {/* Backdrop: plain dim, opacity-only (no backdrop-blur: it is very costly on mobile GPUs) */}
          <motion.div
            {...overlayMotion}
            className="fixed inset-0 bg-green-950/60 z-40"
            style={willAnimate}
            onClick={onClose}
            aria-hidden
          />
          {/* Sheet on mobile, centered dialog on desktop */}
          <motion.div
            key={desktop ? 'dialog' : 'sheet'}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            className={cn(
              'fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-night-800 rounded-t-3xl p-6 outline-none',
              'pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[92dvh] overflow-y-auto overscroll-contain',
              // centered with auto margins (not translate) so framer's transform can't fight the layout
              'md:top-0 md:bottom-0 md:m-auto md:h-fit',
              'md:rounded-3xl md:w-full md:pb-6',
              sizeMap[size],
              className,
            )}
            {...motionProps}
            style={willAnimate}
            drag={desktop ? false : 'y'}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={handleDragEnd}
          >
            {/* Drag handle — mobile only */}
            <div
              className="md:hidden -mt-3 mb-1 flex justify-center py-3 cursor-grab"
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => dragControls.start(e)}
              aria-hidden
            >
              <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full" />
            </div>
            {title && (
              <div className="flex items-center justify-between gap-3 mb-5">
                <h2 id={titleId} className="text-lg font-bold text-green-900 dark:text-white min-w-0 break-words">{title}</h2>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-green-50 text-green-600 hover:bg-green-100 active:scale-95 transition-transform"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </Fragment>
      )}
    </AnimatePresence>
  )
}
