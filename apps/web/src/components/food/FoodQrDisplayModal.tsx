import { useState } from 'react'
import { motion } from 'framer-motion'
import { ShieldCheck, Calendar, AlertTriangle, Eye, EyeOff, X } from 'lucide-react'
import { QrCodeSvg } from '@/components/ui/QrCodeSvg'

interface FoodQrDisplayModalProps {
  isOpen: boolean
  onClose: () => void
  qrToken: string
  collectionPin: string
  cardNumber: number | null
  packageName: string
  status: string
}

export function FoodQrDisplayModal({
  isOpen,
  onClose,
  qrToken,
  collectionPin,
  cardNumber,
  packageName,
  status,
}: FoodQrDisplayModalProps) {
  const [showPin, setShowPin] = useState(false)

  if (!isOpen) return null

  const isCollected = status === 'used'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/75 backdrop-blur-md" />

      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 280 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-center"
        onClick={e => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="px-6 pt-6 pb-3 border-b border-green-100 dark:border-night-600 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🍱</span>
            <div className="text-left">
              <h2 className="text-green-950 dark:text-white font-extrabold text-base">Food Collection Pass</h2>
              <p className="text-green-600 dark:text-night-200 text-xs">Annual Holiday Condiments Distribution</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center text-green-700 dark:text-night-200 hover:bg-green-100 dark:hover:bg-night-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Status Badge */}
          <div>
            {isCollected ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100">
                <ShieldCheck className="w-3.5 h-3.5" /> Package Collected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
                <Calendar className="w-3.5 h-3.5" /> Distribution Day: Dec 10
              </span>
            )}
          </div>

          {/* QR Code Container */}
          <div className="flex flex-col items-center justify-center">
            <div className="p-4 bg-green-50 dark:bg-night-800 rounded-3xl border-2 border-green-200 dark:border-night-500 shadow-inner inline-block">
              <QrCodeSvg value={qrToken} size={190} />
            </div>
            <p className="text-green-500 dark:text-night-300 font-mono text-xs tracking-wider mt-3">
              PASS ID: {qrToken.slice(0, 14)}•••
            </p>
            {cardNumber && (
              <p className="text-green-800 dark:text-white font-bold text-xs mt-0.5">
                Card #{cardNumber} · {packageName}
              </p>
            )}
          </div>

          {/* 4-Digit PIN Security Card */}
          <div className="bg-green-50/80 dark:bg-night-800/80 rounded-2xl p-4 border border-green-200 dark:border-night-600 text-left">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-green-700 dark:text-night-100 font-bold text-xs uppercase tracking-wide">
                Secret 4-Digit Collection PIN
              </span>
              <button
                type="button"
                onClick={() => setShowPin(p => !p)}
                className="flex items-center gap-1 text-xs font-bold text-green-800 dark:text-night-100 hover:underline"
              >
                {showPin ? <><EyeOff className="w-3 h-3" /> Hide</> : <><Eye className="w-3 h-3" /> Reveal</>}
              </button>
            </div>
            <div className="flex items-center justify-center py-2">
              <span className="font-mono text-3xl font-extrabold tracking-[0.4em] text-green-950 dark:text-white">
                {showPin ? collectionPin : '••••'}
              </span>
            </div>
            <p className="text-green-600 dark:text-night-300 text-[11px] leading-relaxed text-center">
              Never share this PIN until you are standing directly with your distribution officer on collection day.
            </p>
          </div>

          {/* Distribution info alert */}
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-2xl p-3.5 flex gap-2.5 text-left">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-amber-900 dark:text-amber-200 text-xs leading-relaxed space-y-1">
              <p className="font-bold">Collection Instructions:</p>
              <p>1. Present this QR code to the verified MonieKing officer at your assigned hub on December 10th.</p>
              <p>2. The officer will scan the code to verify your package entitlement.</p>
              <p>3. Verbally confirm your 4-digit Collection PIN to release the package.</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-green-100 dark:border-night-600 bg-white dark:bg-night-700">
          <button
            onClick={onClose}
            className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all shadow-card"
          >
            Close Pass
          </button>
        </div>
      </motion.div>
    </div>
  )
}
