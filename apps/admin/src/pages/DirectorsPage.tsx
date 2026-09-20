import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { formatDate, cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import type { StaffListItem } from '@/types'

export default function DirectorsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data: directors, isLoading } = useQuery({
    queryKey: ['crm-directors'],
    queryFn: async () => (await api.get<StaffListItem[]>('/users?role=director&page_size=200')).data,
  })

  const createMutation = useMutation({
    mutationFn: (body: { full_name: string; phone_number: string; password: string }) => api.post('/users/directors', body),
    onSuccess: () => {
      toast.success('Director created')
      qc.invalidateQueries({ queryKey: ['crm-directors'] })
      setShowCreate(false)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/users/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Status updated')
      qc.invalidateQueries({ queryKey: ['crm-directors'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-green-900 dark:text-white font-extrabold text-2xl">Directors</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-xs rounded-xl px-4 py-2.5"
        >
          <Plus className="w-3.5 h-3.5" /> Add director
        </button>
      </div>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">{directors?.length ?? 0} directors</p>

      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-green-100 dark:border-night-500 text-left">
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Name</th>
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Phone</th>
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Status</th>
              <th className="px-5 py-3 text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide">Joined</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && [1, 2].map(i => (
              <tr key={i} className="border-b border-green-50 dark:border-night-600">
                <td colSpan={5} className="px-5 py-4"><div className="h-4 bg-green-50 dark:bg-night-600 rounded animate-pulse" /></td>
              </tr>
            ))}
            {!isLoading && directors?.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-green-400 dark:text-night-300 text-sm">No directors yet.</td></tr>
            )}
            {!isLoading && directors?.map(d => (
              <tr key={d.id} className="border-b border-green-50 dark:border-night-600 last:border-0">
                <td className="px-5 py-3 text-green-900 dark:text-white font-semibold flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-copper-500" /> {d.full_name}
                </td>
                <td className="px-5 py-3 text-green-600 dark:text-night-200">{d.phone_number}</td>
                <td className="px-5 py-3">
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', d.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-500')}>
                    {d.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-5 py-3 text-green-500 dark:text-night-200">{formatDate(d.created_at)}</td>
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={() => statusMutation.mutate({ id: d.id, status: d.status === 'active' ? 'suspended' : 'active' })}
                    className={cn('text-xs font-bold', d.status === 'active' ? 'text-red-500' : 'text-green-600 dark:text-night-200')}
                  >
                    {d.status === 'active' ? 'Suspend' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateDirectorModal
          onClose={() => setShowCreate(false)}
          onSubmit={vals => createMutation.mutate(vals)}
          submitting={createMutation.isPending}
        />
      )}
    </div>
  )
}

function CreateDirectorModal({ onClose, onSubmit, submitting }: {
  onClose: () => void
  onSubmit: (vals: { full_name: string; phone_number: string; password: string }) => void
  submitting: boolean
}) {
  const [fullName, setFullName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [password, setPassword] = useState('')

  return (
    <Modal title="Add director" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSubmit({ full_name: fullName, phone_number: phoneNumber, password }) }} className="space-y-4">
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
        <button type="submit" disabled={submitting}
          className="w-full bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold rounded-xl py-2.5 disabled:opacity-50">
          {submitting ? 'Creating…' : 'Create director'}
        </button>
      </form>
    </Modal>
  )
}
