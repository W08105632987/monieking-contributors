import { MessageCircle, Mail, ExternalLink } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'

const WHATSAPP_NUMBER = '2348038995252'
const SUPPORT_EMAIL = 'joinmonieking@gmail.com'

interface ContactSupportSheetProps {
  open: boolean
  onClose: () => void
}

/**
 * Shared "Contact" sheet — same two support channels, reused from
 * every role's Profile page (customer, officer, director) rather than
 * duplicating the WhatsApp number / email address in three places.
 */
export function ContactSupportSheet({ open, onClose }: ContactSupportSheetProps) {
  return (
    <Modal open={open} onClose={onClose} title="Contact support" size="sm">
      <div className="space-y-3">
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 bg-green-50 dark:bg-night-600 rounded-2xl p-4 active:scale-[0.98] transition-all"
        >
          <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center shrink-0">
            <MessageCircle className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-green-950 dark:text-white font-bold text-sm">WhatsApp</p>
            <p className="text-green-500 dark:text-night-300 text-xs">+{WHATSAPP_NUMBER}</p>
          </div>
          <ExternalLink className="w-4 h-4 text-green-400 dark:text-night-300 shrink-0" />
        </a>

        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="flex items-center gap-3 bg-green-50 dark:bg-night-600 rounded-2xl p-4 active:scale-[0.98] transition-all"
        >
          <div className="w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-green-900" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-green-950 dark:text-white font-bold text-sm">Email</p>
            <p className="text-green-500 dark:text-night-300 text-xs truncate">{SUPPORT_EMAIL}</p>
          </div>
          <ExternalLink className="w-4 h-4 text-green-400 dark:text-night-300 shrink-0" />
        </a>
      </div>
    </Modal>
  )
}
