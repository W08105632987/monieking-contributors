import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ChevronRight, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatDate, cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import type { StaffListItem, Zone } from '@/types'

export default function OfficersPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['crm-officers'],
    queryFn: async () => (await api.get<StaffListItem[]>('/users?role=officer&page_size=200')).data,
  })

  const { data: zones } = useQuery({
    queryKey: ['crm-zones'],
    queryFn: async () => (await api.get<Zone[]>('/zones')).data,
  })

  const filtered = (data ?? []).filter(o =>
    !query.trim() ||
    o.full_name.toLowerCase().includes(query.toLowerCase()) ||
    o.phone_number.includes(query),
  )

  const createMutation = useMutation({
    mutationFn: (body: { full_name: string; phone_number: string; password: string; zone_id: string }) =>
      api.post('/users/officers', body),
    onSuccess: () => {
      toast.success('Officer created')
      qc.invalidateQueries({ queryKey: ['crm-officers'] })
      qc.invalidateQueries({ queryKey: ['crm-zones'] })
      setShowCreate(false)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-green-900 dark:text-white font-extrabold text-2xl">Officers</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-xs rounded-xl px-4 py-2.5"
        >
          <Plus className="w-3.5 h-3.5" /> Add officer
        </button>
      </div>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">{data?.length ?? 0} officers on the platform</p>

      <div className="relative mb-5 max-w-md">
        <Search className="w-4 h-4 text-green-400 dark:text-night-300 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search officers…"
          className="w-full bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl pl-10 pr-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500"
        />
      </div>

      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-green-100 dark:border-night-500 text-left">
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Name</th>
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Phone</th>
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Zone</th>
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Status</th>
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Joined</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && [1, 2, 3].map(i => (
              <tr key={i} className="border-b border-green-50 dark:border-night-600">
                <td colSpan={6} className="px-5 py-4"><div className="h-4 bg-green-50 dark:bg-night-600 rounded animate-pulse" /></td>
              </tr>
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-green-400 dark:text-night-300 text-sm">No officers found.</td></tr>
            )}
            {!isLoading && filtered.map(o => (
              <tr
                key={o.id}
                onClick={() => navigate(`/officers/${o.id}`)}
                className="border-b border-green-50 dark:border-night-600 last:border-0 hover:bg-green-50/60 dark:hover:bg-night-600/60 cursor-pointer transition-colors"
              >
                <td className="px-5 py-3 text-green-900 dark:text-white font-semibold">{o.full_name}</td>
                <td className="px-5 py-3 text-green-600 dark:text-night-200">{o.phone_number}</td>
                <td className="px-5 py-3 text-green-600 dark:text-night-200">{o.zone_name ?? <span className="text-amber-500 text-xs font-semibold">Unassigned</span>}</td>
                <td className="px-5 py-3">
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', o.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-500')}>
                    {o.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-5 py-3 text-green-500 dark:text-night-200">{formatDate(o.created_at)}</td>
                <td className="px-5 py-3 text-right"><ChevronRight className="w-4 h-4 text-green-300 dark:text-night-400 inline-block" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateOfficerModal
          zones={zones ?? []}
          onClose={() => setShowCreate(false)}
          onSubmit={vals => createMutation.mutate(vals)}
          submitting={createMutation.isPending}
        />
      )}
    </div>
  )
}

function CreateOfficerModal({
  zones, onClose, onSubmit, submitting,
}: {
  zones: Zone[]
  onClose: () => void
  onSubmit: (vals: { full_name: string; phone_number: string; password: string; zone_id: string }) => void
  submitting: boolean
}) {
  const [fullName, setFullName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [password, setPassword] = useState('')
  const [zoneId, setZoneId] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!zoneId) { toast.error('Choose a zone for this officer'); return }
    onSubmit({ full_name: fullName, phone_number: phoneNumber, password, zone_id: zoneId })
  }

  return (
    <Modal title="Add officer" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1.5">Full name</label>
          <input required value={fullName} onChange={e => setFullName(e.target.value)}
            className="w-full border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500" />
        </div>
        <div>
          <label className="block text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1.5">Phone number</label>
          <input required value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
            className="w-full border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500" />
        </div>
        <div>
          <label className="block text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1.5">Temporary password</label>
          <input required type="text" value={password} onChange={e => setPassword(e.target.value)}
            className="w-full border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500" />
        </div>
        <div>
          <label className="block text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1.5">Zone</label>
          <select required value={zoneId} onChange={e => setZoneId(e.target.value)}
            className="w-full border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500">
            <option value="">Select a zone…</option>
            {zones.map(z => <option key={z.id} value={z.id}>{z.name}{z.current_officer_name ? ` (currently ${z.current_officer_name})` : ''}</option>)}
          </select>
        </div>
        <button type="submit" disabled={submitting}
          className="w-full bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold rounded-xl py-2.5 disabled:opacity-50">
          {submitting ? 'Creating…' : 'Create officer'}
        </button>
      </form>
    </Modal>
  )
}
