import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { getInstallPrompt, onInstallPromptCaptured, clearInstallPrompt } from '@/lib/pwaInstall'

const DISMISS_KEY = 'monieking-install-dismissed'

export function InstallPrompt() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    const dismissed = sessionStorage.getItem(DISMISS_KEY)
    if (isStandalone || dismissed) return

    // The event may have already been captured before this component ever
    // mounted (e.g. it fired while the user was still on the login page).
    // Show it immediately in that case — no need to wait for anything else.
    if (getInstallPrompt()) {
      setVisible(true)
      return
    }

    // Otherwise, it hasn't fired yet — subscribe so we show it the instant
    // Chrome does decide to grant it, whenever that happens to be.
    return onInstallPromptCaptured(() => setVisible(true))
  }, [])

  const handleInstall = async () => {
    const deferredPrompt = getInstallPrompt()
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    clearInstallPrompt()
    setVisible(false)
  }

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed left-4 right-4 z-40 bg-green-900 rounded-2xl p-4 flex items-center gap-3 shadow-card-lg"
      style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}
    >
      <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center flex-shrink-0">
        <Download className="w-5 h-5 text-green-900" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold text-sm">Install MonieKing</p>
        <p className="text-green-300 text-xs">Add to your home screen for quick access</p>
      </div>
      <button onClick={handleInstall} className="bg-amber-400 text-green-900 text-xs font-bold rounded-full px-3.5 py-2 flex-shrink-0">
        Install
      </button>
      <button onClick={handleDismiss} className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0" aria-label="Dismiss">
        <X className="w-3 h-3 text-white" />
      </button>
    </div>
  )
}
