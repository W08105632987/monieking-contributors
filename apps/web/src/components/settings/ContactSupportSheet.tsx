import { MessageCircle, Mail, ExternalLink, Phone, Users } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { Modal } from '@/components/ui/Modal'
import { useSupportContact } from '@/components/support/ContactSupport'

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
  // The director sets these in Business Settings; the built-in WhatsApp number is only a fallback while that loads.
  const { data } = useSupportContact()
  const wa = data?.whatsapp || WHATSAPP_NUMBER
  // Same community link the director sets in Business Settings (also used by the first-sign-in prompt).
  const user = useAuthStore((s) => s.user)
  const { data: community } = useQuery({
    queryKey: ['whatsapp-community-link', user?.id],
    queryFn: async () => (await api.get<{ link: string; button: string }>('/community/whatsapp')).data,
    enabled: open && user?.role === 'customer', staleTime: 5 * 60_000, retry: 0,
  })
  const joinCommunity = () => { api.post('/community/whatsapp/joined').catch(() => {}) }
  return (
    <Modal open={open} onClose={onClose} title="Contact support" size="sm">
      <div className="space-y-3">
        {data?.tel_url && (
          <a href={data.tel_url} className="flex items-center gap-3 bg-green-50 dark:bg-night-600 rounded-2xl p-4 active:scale-[0.98] transition-all">
            <div className="w-10 h-10 rounded-full bg-green-900 flex items-center justify-center shrink-0"><Phone className="w-5 h-5 text-white" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-green-950 dark:text-white font-bold text-sm">Call support</p>
              <p className="text-green-500 dark:text-night-300 text-xs">{data.phone}</p>
            </div>
            <ExternalLink className="w-4 h-4 text-green-400 dark:text-night-300 shrink-0" />
          </a>
        )}
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 bg-green-50 dark:bg-night-600 rounded-2xl p-4 active:scale-[0.98] transition-all"
        >
          <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center shrink-0">
            <MessageCircle className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-green-950 dark:text-white font-bold text-sm">WhatsApp</p>
            <p className="text-green-500 dark:text-night-300 text-xs">+{wa}</p>
          </div>
          <ExternalLink className="w-4 h-4 text-green-400 dark:text-night-300 shrink-0" />
        </a>

        {community?.link && (
          <a
            href={community.link} target="_blank" rel="noopener noreferrer" onClick={joinCommunity}
            className="flex items-center justify-center gap-2 bg-amber-400 text-green-950 font-extrabold text-sm rounded-2xl p-4 active:scale-[0.98] transition-all"
          >
            <Users className="w-5 h-5" /> Tap to join community
          </a>
        )}

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
