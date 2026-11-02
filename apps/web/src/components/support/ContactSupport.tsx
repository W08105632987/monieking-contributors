import { useState } from 'react'
import { Phone, MessageCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface SupportContact { phone: string; whatsapp: string; configured: boolean; tel_url: string | null; whatsapp_url: string | null }

/** The one place every "Contact support" button reads the number from. The director sets it in Business Settings. */
export function useSupportContact() {
  return useQuery({
    queryKey: ['support-contact'],
    queryFn: async () => (await api.get<SupportContact>('/support-contact')).data,
    staleTime: 5 * 60_000,
  })
}

/** Opens the phone dialer with the support number (and offers WhatsApp when the director set one). */
export function ContactSupportButton({ className, label = 'Contact support', compact = false }: { className?: string; label?: string; compact?: boolean }) {
  const { data } = useSupportContact()
  if (!data?.configured) {
    return <p className={cn('text-xs font-semibold text-green-600 dark:text-night-200', className)}>Support number is not available yet. Please ask your officer.</p>
  }
  return (
    <div className={cn('flex gap-2', className)}>
      {data.tel_url && (
        <a href={data.tel_url} className={cn('flex flex-1 items-center justify-center gap-2 rounded-full bg-green-900 font-bold text-white active:scale-95 dark:bg-night-100 dark:text-night-900', compact ? 'py-2.5 text-xs' : 'py-3.5 text-sm')}>
          <Phone className="h-4 w-4" /> {label}{data.phone && !compact ? ` · ${data.phone}` : ''}
        </a>
      )}
      {data.whatsapp_url && (
        <a href={data.whatsapp_url} target="_blank" rel="noopener noreferrer" aria-label="Chat with support on WhatsApp"
           className={cn('flex items-center justify-center gap-2 rounded-full bg-[#25D366] font-bold text-white active:scale-95', data.tel_url ? 'px-4' : 'flex-1', compact ? 'py-2.5 text-xs' : 'py-3.5 text-sm')}>
          <MessageCircle className="h-4 w-4" />{!data.tel_url && ' WhatsApp support'}
        </a>
      )}
    </div>
  )
}

/** "Forgot your <thing>? Contact support": a link-style line that opens the real Contact Support button when tapped. */
export function ForgotContactSupport({ thing, className }: { thing: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('text-center', className)}>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-bold text-green-700 underline underline-offset-2 dark:text-night-100">
          Forgot your {thing}? Contact support
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-green-600 dark:text-night-200">Support can verify you and reset your {thing}.</p>
          <ContactSupportButton compact />
        </div>
      )}
    </div>
  )
}
