import { AlertTriangle, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MonnifyStatus } from '@/hooks/useBillHealth'

/** Live status of our payment provider (Monnify), read from their public status page. Quiet when all is well, loud when it is not. */
export function MonnifyStatusBanner({ status }: { status?: MonnifyStatus }) {
  if (!status || !status.ok) return null
  if (status.level === 'operational') {
    return (
      <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold text-green-600 dark:text-green-300">
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" /></span>
        Payment network: all systems operational
      </div>
    )
  }
  const bad = status.level === 'outage'
  const Icon = status.level === 'maintenance' ? Wrench : AlertTriangle
  const detail = [...(status.incidents ?? []).map(i => i.name), ...(status.maintenance ?? []).map(m => m.name)].filter(Boolean).slice(0, 2).join(' · ')
  return (
    <div className={cn('mb-3 flex gap-2 rounded-2xl border p-3 text-xs', bad ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200')}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-bold">{bad ? 'Our payment network is having problems' : status.level === 'maintenance' ? 'Payment network maintenance' : 'Our payment network is slow right now'}</p>
        <p className="mt-0.5 leading-relaxed">{detail || status.description || 'Some purchases may fail or take longer.'} {bad ? 'Purchases may fail; any failed purchase is refunded.' : ''}</p>
      </div>
    </div>
  )
}
