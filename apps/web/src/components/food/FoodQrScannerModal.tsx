import { useState } from 'react'
import { motion } from 'framer-motion'
import { ShieldCheck, Scan, CheckCircle2, AlertCircle, Loader2, ArrowRight, X, UserCheck, Camera, Keyboard } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from 'react-hot-toast'
import { CameraQrScanner } from './CameraQrScanner'

interface FoodQrScannerModalProps {
  isOpen: boolean
  onClose: () => void
}

interface MaskedVerification {
  entitlement_id: string
  masked_name: string
  masked_card: string
  package_name: string
  status: string
  year: number
  is_eligible_for_collection: boolean
  message: string
}

export function FoodQrScannerModal({ isOpen, onClose }: FoodQrScannerModalProps) {
  const [tokenInput, setTokenInput] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [verification, setVerification] = useState<MaskedVerification | null>(null)
  const [confirmedAudit, setConfirmedAudit] = useState<{ audit_code: string; message: string } | null>(null)

  if (!isOpen) return null

  // Core verification routine
  const verifyQrToken = async (rawToken: string) => {
    const trimmed = rawToken.trim()
    if (!trimmed) return

    setLoading(true)
    try {
      const { data } = await api.post<MaskedVerification>('/food-collections/verify-qr', {
        qr_token: trimmed,
      })
      setVerification(data)
      setShowCamera(false)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to verify food QR code.')
    } finally {
      setLoading(false)
    }
  }

  // Step 1 Form Submit: Manual entry
  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    await verifyQrToken(tokenInput)
  }

  // Camera scan callback
  const handleCameraScan = async (scannedText: string) => {
    setTokenInput(scannedText)
    await verifyQrToken(scannedText)
  }

  // Step 2: Confirm Dispensation with PIN
  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!verification || !pinInput.trim()) return

    setLoading(true)
    try {
      const { data } = await api.post<{ audit_code: string; message: string }>('/food-collections/confirm', {
        entitlement_id: verification.entitlement_id,
        collection_pin: pinInput.trim(),
      })
      setConfirmedAudit(data)
      toast.success('Food collection confirmed successfully!')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Incorrect PIN or collection failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setTokenInput('')
    setPinInput('')
    setVerification(null)
    setConfirmedAudit(null)
    setShowCamera(false)
  }

  const handleClose = () => {
    setShowCamera(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-green-950/75 backdrop-blur-md" />

      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 280 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-3 border-b border-green-100 dark:border-night-600 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-night-600 text-green-800 dark:text-night-100 flex items-center justify-center">
              <Scan className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-green-950 dark:text-white font-extrabold text-base">Food Distribution Scanner</h2>
              <p className="text-green-600 dark:text-night-200 text-xs">Officer Verification & Dispensation Terminal</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-green-50 dark:bg-night-600 flex items-center justify-center text-green-700 dark:text-night-200 hover:bg-green-100 dark:hover:bg-night-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Confirmed Success State */}
          {confirmedAudit ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-green-950 dark:text-white font-extrabold text-xl">Package Dispensed!</h3>
              <p className="text-green-700 dark:text-night-200 text-sm">
                Audit Confirmation Code:
              </p>
              <div className="p-3 bg-green-50 dark:bg-night-800 rounded-2xl border border-green-200 dark:border-night-600">
                <span className="font-mono text-lg font-bold text-green-900 dark:text-white">
                  {confirmedAudit.audit_code}
                </span>
              </div>
              <button
                onClick={handleReset}
                className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3.5 mt-4"
              >
                Scan Next Customer
              </button>
            </div>
          ) : !verification ? (
            /* Step 1: Scan with Camera OR Enter QR Token */
            <div className="space-y-4 text-left">
              {showCamera ? (
                /* Live Camera Scanner Viewfinder */
                <div className="space-y-3">
                  <CameraQrScanner
                    onScan={handleCameraScan}
                    onClose={() => setShowCamera(false)}
                  />
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setShowCamera(false)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-green-800 dark:text-night-100 hover:underline py-1"
                    >
                      <Keyboard className="w-3.5 h-3.5" /> Switch to Manual Code Entry
                    </button>
                  </div>
                </div>
              ) : (
                /* Manual / Barcode input mode with prominent camera button */
                <div className="space-y-4">
                  {/* Big Primary "Scan with Camera" Button */}
                  <button
                    type="button"
                    onClick={() => setShowCamera(true)}
                    className="w-full bg-gradient-to-r from-green-800 to-green-950 dark:from-night-600 dark:to-night-700 text-white font-bold text-sm rounded-2xl py-4 flex items-center justify-center gap-2.5 shadow-card hover:opacity-95 active:scale-98 transition-all border border-green-700/50"
                  >
                    <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                      <Camera className="w-4 h-4 text-white" />
                    </div>
                    <span>Open Live Camera Scanner</span>
                  </button>

                  <div className="flex items-center gap-3 my-2">
                    <div className="flex-1 h-px bg-green-100 dark:bg-night-600" />
                    <span className="text-[11px] font-bold text-green-600 dark:text-night-300 uppercase tracking-wider">
                      Or enter pass code manually
                    </span>
                    <div className="flex-1 h-px bg-green-100 dark:bg-night-600" />
                  </div>

                  <form onSubmit={handleVerify} className="space-y-3">
                    <div>
                      <label className="block text-green-800 dark:text-night-100 text-xs font-bold uppercase tracking-wider mb-1.5">
                        Customer QR Token / Pass ID
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={tokenInput}
                          onChange={e => setTokenInput(e.target.value)}
                          placeholder="Scan QR or enter MKF_..."
                          className="w-full border-2 border-green-200 dark:border-night-500 rounded-2xl px-4 py-3.5 text-sm text-green-900 dark:text-white font-mono focus:outline-none focus:border-green-600 dark:focus:border-night-200 bg-white dark:bg-night-800"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading || !tokenInput.trim()}
                      className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-card"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Verify Customer Pass <ArrowRight className="w-4 h-4" /></>}
                    </button>
                  </form>
                </div>
              )}

              <div className="bg-green-50 dark:bg-night-800/80 rounded-2xl p-4 border border-green-200 dark:border-night-600 text-xs text-green-700 dark:text-night-200 space-y-1.5 mt-2">
                <p className="font-bold flex items-center gap-1.5 text-green-900 dark:text-white">
                  <ShieldCheck className="w-4 h-4 text-green-600" /> Two-Factor Verification Protocol
                </p>
                <p>Scanning the QR identifies the entitlement, but does not allow collection until the customer provides their matching 4-digit PIN.</p>
              </div>
            </div>
          ) : (
            /* Step 2: Show Masked Beneficiary & Prompt for PIN */
            <form onSubmit={handleConfirm} className="space-y-4 text-left">
              {/* Beneficiary Card */}
              <div className="p-4 bg-green-50/90 dark:bg-night-800 rounded-2xl border border-green-200 dark:border-night-600 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-green-600 dark:text-night-200 uppercase">Beneficiary</span>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-green-200/70 dark:bg-night-600 text-green-900 dark:text-white">
                    {verification.masked_card}
                  </span>
                </div>
                <p className="text-lg font-extrabold text-green-950 dark:text-white flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
                  {verification.masked_name}
                </p>
                <p className="text-xs text-green-700 dark:text-night-200">
                  Package: <strong className="text-green-900 dark:text-white">{verification.package_name}</strong>
                </p>
                <div className="pt-2 border-t border-green-200 dark:border-night-700">
                  <p className="text-xs font-semibold text-green-800 dark:text-night-100">
                    {verification.message}
                  </p>
                </div>
              </div>

              {verification.is_eligible_for_collection ? (
                <>
                  <div>
                    <label className="block text-green-800 dark:text-night-100 text-xs font-bold uppercase tracking-wider mb-2">
                      Enter Customer's 4-Digit Collection PIN
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={pinInput}
                      onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••"
                      autoFocus
                      className="w-full border-2 border-green-200 dark:border-night-500 rounded-2xl px-4 py-3.5 text-center text-2xl tracking-[0.5em] font-mono text-green-950 dark:text-white focus:outline-none focus:border-green-600 dark:focus:border-night-200 bg-white dark:bg-night-800"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="flex-1 border-2 border-green-200 dark:border-night-500 text-green-700 dark:text-night-200 font-bold text-sm rounded-full py-3.5"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={loading || pinInput.length !== 4}
                      className="flex-1 bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3.5 disabled:opacity-50 flex items-center justify-center gap-2 shadow-card"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm & Dispense'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-2xl flex gap-2">
                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
                    <p className="text-red-900 dark:text-red-200 text-xs">
                      This QR code cannot be collected because the entitlement status is <strong>{verification.status.toUpperCase()}</strong>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-3.5"
                  >
                    Scan Another QR
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      </motion.div>
    </div>
  )
}
