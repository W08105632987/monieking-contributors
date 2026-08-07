import { Fragment, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeMap = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' }

export function Modal({ open, onClose, title, children, className, size = 'md' }: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <Fragment>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-green-950/60 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Sheet — slides up from bottom on mobile */}
          <motion.div
            className={cn(
              'fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl p-6',
              'md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2',
              'md:rounded-3xl md:w-full',
              sizeMap[size],
              className,
            )}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* Drag handle — mobile only */}
            <div className="w-10 h-1 bg-green-200 rounded-full mx-auto mb-4 md:hidden" />
            {title && (
              <div className="flex items-center justify-between gap-3 mb-5">
                <h2 className="text-lg font-bold text-green-900 min-w-0 break-words">{title}</h2>
                <button
                  onClick={onClose}
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-green-50 text-green-600 hover:bg-green-100"
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
