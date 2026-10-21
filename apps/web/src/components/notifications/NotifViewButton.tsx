import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { AppNotification } from '@/types'

/** Where a notification opens: the server-supplied link (dispute chat, card, wallet…). */
export function notifTarget(n: AppNotification): string | null {
  const l = n.link
  return l && l.startsWith('/') ? l : null
}

/** "View" button shown inside a notification's detail sheet. Renders nothing when there is nowhere to go. */
export function NotifViewButton({ notif, onNavigate }: { notif: AppNotification; onNavigate?: () => void }) {
  const navigate = useNavigate()
  const to = notifTarget(notif)
  if (!to) return null
  return (
    <button
      onClick={() => { onNavigate?.(); navigate(to) }}
      className="w-full mt-5 flex items-center justify-center gap-2 bg-green-600 text-white font-bold text-sm py-3 rounded-xl active:scale-95 transition-all"
    >
      View <ArrowRight className="w-4 h-4" />
    </button>
  )
}
