import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Plus, Shield, UserCog, MoreVertical } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { BottomNav } from '@/components/layout/BottomNav'
import { ManageMemberSheet } from '@/components/settings/ManageMemberSheet'
import { cn, initials, formatDate } from '@/lib/utils'
import type { User, Zone } from '@/types'

type StaffTab = 'officers' | 'directors'

function StaffRow({ member, onManage }: { member: User; onManage: () => void }) {
  const navigate = useNavigate()
  const isOfficer = member.role === 'officer'

  return (
    <div className="w-full flex items-center gap-3 py-3.5 border-b border-green-50 dark:border-night-600 last:border-0">
      <button
        onClick={() => isOfficer ? navigate(`/director/officers/${member.customer_number}`) : onManage()}
        className="flex-1 min-w-0 flex items-center gap-3 text-left active:bg-green-50/50 dark:bg-night-600/50 transition-all"
      >
        <div className="w-10 h-10 rounded-full bg-green-900 dark:bg-night-100 flex items-center justify-center font-bold text-amber-400 dark:text-night-100 text-sm flex-shrink-0">
          {initials(member.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-green-900 dark:text-white text-sm font-semibold truncate">{member.full_name}</p>
          <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{member.phone_number} · joined {formatDate(member.created_at)}</p>
        </div>
        <span className={cn(
          'text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0',
          member.status === 'active' ? 'bg-green-100 dark:bg-night-600 text-green-700 dark:text-night-100' : 'bg-red-50 dark:bg-red-900 text-red-500 dark:text-red-300',
        )}>
          {member.status === 'active' ? 'Active' : 'Suspended'}
        </span>
      </button>
      <button onClick={onManage} aria-label={`Manage ${member.full_name}`} className="flex-shrink-0 p-1">
        <MoreVertical className="w-4 h-4 text-green-300 dark:text-night-300" />
      </button>
    </div>
  )
}

// ── Create staff sheet ──────────────────────────────────────────
function CreateStaffSheet({ tab, onClose }: { tab: StaffTab; onClose: () => void }) {
  const qc = useQueryClient()
  const [fullName, setFullName]   = useState('')
  const [phone, setPhone]         = useState('')
  const [password, setPassword]   = useState('')
  const [zoneId, setZoneId]       = useState('')

  const { data: zones = [] } = useQuery({
    queryKey: ['zones'],
    queryFn: async () => { const { data } = await api.get<Zone[]>('/zones'); return data },
    enabled: tab === 'officers',
  })

  const createMutation = useMutation({
    mutationFn: () => {
      const endpoint = tab === 'officers' ? '/users/officers' : '/users/directors'
      const body: Record<string, unknown> = { full_name: fullName, phone_number: phone, password }
      if (tab === 'officers') body.zone_id = zoneId
      return api.post(endpoint, body)
    },
    onSuccess: () => {
      toast.success(`${tab === 'officers' ? 'Officer' : 'Director'} created`)
      qc.invalidateQueries({ queryKey: ['staff', tab] })
      onClose()
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const canSubmit = fullName.trim() && phone.trim().length >= 10 && password.length >= 6 && (tab === 'directors' || zoneId)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 dark:bg-night-900/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-5" />
        <h2 className="text-green-900 dark:text-white font-extrabold text-xl mb-5">
          New {tab === 'officers' ? 'Officer' : 'Director'}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">Full name</label>
            <input value={fullName} onChange={e => setFullName(e.target.value)}
              className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm text-green-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">Phone number</label>
            <input value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              placeholder="08012345678"
              className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm text-green-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            <p className="text-green-400 dark:text-night-300 text-xs mt-1">Login will be this phone number + the password below</p>
          </div>
          <div>
            <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">Password</label>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password"
              className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm text-green-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          {tab === 'officers' && (
            <div>
              <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">Zone</label>
              <select value={zoneId} onChange={e => setZoneId(e.target.value)}
                className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm text-green-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-night-700">
                <option value="">Select a zone…</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              {zones.length === 0 && (
                <p className="text-amber-600 dark:text-amber-300 text-xs mt-1">No zones yet — add one from Business Settings first.</p>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit || createMutation.isPending}
          className="w-full bg-green-900 dark:bg-night-100 text-white font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-40 mt-6"
        >
          {createMutation.isPending ? 'Creating…' : `Create ${tab === 'officers' ? 'Officer' : 'Director'}`}
        </button>
      </motion.div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function StaffPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<StaffTab>('officers')
  const [showCreate, setShowCreate] = useState(false)
  const [managingMember, setManagingMember] = useState<User | null>(null)

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['staff', tab],
    queryFn: async () => {
      const role = tab === 'officers' ? 'officer' : 'director'
      const { data } = await api.get<User[]>(`/users?role=${role}&page_size=100`)
      return data
    },
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Staff</h1>
      </header>

      <div className="px-4 mb-4">
        <div className="flex gap-2">
          {(['officers', 'directors'] as StaffTab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-all',
                tab === t ? 'bg-green-900 dark:bg-night-100 text-white dark:text-night-900 shadow-card' : 'bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 text-green-600 dark:text-night-200')}
            >
              {t === 'officers' ? <UserCog className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
              {t === 'officers' ? 'Officers' : 'Directors'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-40">
        <button
          onClick={() => setShowCreate(true)}
          className="w-full flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-500 text-green-950 font-bold text-sm rounded-2xl py-3.5 active:scale-95 transition-all mb-4 shadow-card"
        >
          <Plus className="w-4 h-4" /> New {tab === 'officers' ? 'Officer' : 'Director'}
        </button>

        {isLoading ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-3 py-3.5 border-b border-green-50 dark:border-night-600 last:border-0">
                <div className="w-10 h-10 bg-green-100 dark:bg-night-600 rounded-full animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-green-100 dark:bg-night-600 rounded animate-pulse w-2/3" />
                  <div className="h-2 bg-green-50 dark:bg-night-600 rounded animate-pulse w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : staff.length === 0 ? (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card text-center py-12 px-6">
            <p className="text-green-700 dark:text-night-100 font-semibold text-sm">No {tab} yet</p>
            <p className="text-green-400 dark:text-night-300 text-xs mt-1">Create the first one above</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4">
            {staff.map(member => <StaffRow key={member.id} member={member} onManage={() => setManagingMember(member)} />)}
          </div>
        )}
      </div>

      <BottomNav />

      <AnimatePresence>
        {showCreate && <CreateStaffSheet tab={tab} onClose={() => setShowCreate(false)} />}
        {managingMember && (
          <ManageMemberSheet
            member={managingMember}
            onClose={() => setManagingMember(null)}
            invalidateKeys={[['staff', tab]]}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
