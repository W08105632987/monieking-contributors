import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, MapPin, Users, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import type { Zone, StaffListItem } from '@/types'

export default function ZonesPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [assigningZone, setAssigningZone] = useState<Zone | null>(null)

  const { data: zones, isLoading } = useQuery({
    queryKey: ['crm-zones'],
    queryFn: async () => (await api.get<Zone[]>('/zones')).data,
  })

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) => api.post('/zones', body),
    onSuccess: () => {
      toast.success('Zone created')
      qc.invalidateQueries({ queryKey: ['crm-zones'] })
      setShowCreate(false)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const deleteMutation = useMutation({
    mutationFn: (zoneId: string) => api.delete(`/zones/${zoneId}`),
    onSuccess: () => {
      toast.success('Zone deleted')
      qc.invalidateQueries({ queryKey: ['crm-zones'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-green-900 dark:text-white font-extrabold text-2xl">Zones</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold text-xs rounded-xl px-4 py-2.5"
        >
          <Plus className="w-3.5 h-3.5" /> Add zone
        </button>
      </div>
      <p className="text-green-500 dark:text-night-200 text-sm mb-6">{zones?.length ?? 0} zones</p>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-32 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {zones?.map(z => (
            <div key={z.id} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-5">
              <div className="flex items-start justify-between mb-2">
                <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-green-700 dark:text-night-200" />
                </div>
                <button onClick={() => deleteMutation.mutate(z.id)} className="text-green-300 dark:text-night-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-green-900 dark:text-white font-bold text-sm mb-1">{z.name}</p>
              <p className="text-green-400 dark:text-night-300 text-xs mb-3 line-clamp-2">{z.description ?? 'No description'}</p>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs text-green-500 dark:text-night-200">
                  <Users className="w-3.5 h-3.5" /> {z.current_officer_name ?? 'Unassigned'}
                </span>
                <button onClick={() => setAssigningZone(z)} className="text-green-700 dark:text-copper-400 text-xs font-bold">
                  {z.current_officer_name ? 'Reassign' : 'Assign'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateZoneModal
          onClose={() => setShowCreate(false)}
          onSubmit={vals => createMutation.mutate(vals)}
          submitting={createMutation.isPending}
        />
      )}
      {assigningZone && (
        <AssignOfficerModal
          zone={assigningZone}
          onClose={() => setAssigningZone(null)}
          onDone={() => { setAssigningZone(null); qc.invalidateQueries({ queryKey: ['crm-zones'] }) }}
        />
      )}
    </div>
  )
}

function CreateZoneModal({ onClose, onSubmit, submitting }: {
  onClose: () => void
  onSubmit: (vals: { name: string; description: string }) => void
  submitting: boolean
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  return (
    <Modal title="Add zone" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSubmit({ name, description }) }} className="space-y-4">
        <div>
          <label className="block text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1.5">Zone name</label>
          <input required value={name} onChange={e => setName(e.target.value)}
            className="w-full border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500" />
        </div>
        <div>
          <label className="block text-green-500 dark:text-night-200 text-xs font-semibold uppercase tracking-wide mb-1.5">Description (optional)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            className="w-full border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500" />
        </div>
        <button type="submit" disabled={submitting}
          className="w-full bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold rounded-xl py-2.5 disabled:opacity-50">
          {submitting ? 'Creating…' : 'Create zone'}
        </button>
      </form>
    </Modal>
  )
}

function AssignOfficerModal({ zone, onClose, onDone }: { zone: Zone; onClose: () => void; onDone: () => void }) {
  const [officerId, setOfficerId] = useState('')

  const { data: officers } = useQuery({
    queryKey: ['crm-officers-for-assign'],
    queryFn: async () => (await api.get<StaffListItem[]>('/users?role=officer&page_size=200')).data,
  })

  const assignMutation = useMutation({
    mutationFn: () => api.post(`/zones/${zone.id}/assign`, { officer_id: officerId }),
    onSuccess: (res: any) => { toast.success(res.data?.message ?? 'Officer assigned'); onDone() },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  return (
    <Modal title={`Assign officer to ${zone.name}`} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); assignMutation.mutate() }} className="space-y-4">
        <select required value={officerId} onChange={e => setOfficerId(e.target.value)}
          className="w-full border border-green-200 dark:border-night-500 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white focus:outline-none focus:border-green-500">
          <option value="">Select an officer…</option>
          {officers?.map(o => <option key={o.id} value={o.id}>{o.full_name}{o.zone_name ? ` (currently ${o.zone_name})` : ''}</option>)}
        </select>
        <button type="submit" disabled={assignMutation.isPending}
          className="w-full bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold rounded-xl py-2.5 disabled:opacity-50">
          {assignMutation.isPending ? 'Assigning…' : 'Assign'}
        </button>
      </form>
    </Modal>
  )
}
