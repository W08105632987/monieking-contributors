import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Ban, CheckCircle2, Trash2, AlertTriangle } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import type { User } from '@/types'

interface ManageMemberSheetProps {
  member: User
  onClose: () => void
  invalidateKeys: string[][]
  onDeleted?: () => void
}

export function ManageMemberSheet({ member, onClose, invalidateKeys, onDeleted }: ManageMemberSheetProps) {
  const qc = useQueryClient()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const invalidateAll = () => invalidateKeys.forEach(key => qc.invalidateQueries({ queryKey: key }))

  const statusMutation = useMutation({
    mutationFn: (status: 'active' | 'suspended') => api.patch(`/users/${member.id}/status`, { status }),
    onSuccess: (_, status) => {
      toast.success(status === 'suspended' ? `${member.full_name} suspended` : `${member.full_name} reactivated`)
      invalidateAll()
      onClose()
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/users/${member.id}`),
    onSuccess: () => {
      toast.success(`${member.full_name} deleted`)
      if (onDeleted) {
        onDeleted()
      } else {
        invalidateAll()
        onClose()
      }
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const isActive = member.status === 'active'
  const nameMatches = confirmText.trim().toLowerCase() === member.full_name.trim().toLowerCase()

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white rounded-t-3xl w-full max-w-lg p-6 pb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-green-900 font-extrabold text-lg">{member.full_name}</h2>
            <p className="text-green-400 text-xs">{member.phone_number}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center">
            <X className="w-4 h-4 text-green-600" />
          </button>
        </div>

        {!confirmingDelete ? (
          <div className="space-y-2.5">
            <button
              onClick={() => statusMutation.mutate(isActive ? 'suspended' : 'active')}
              disabled={statusMutation.isPending}
              className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left font-bold text-sm disabled:opacity-50 ${
                isActive ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
              }`}
            >
              {isActive ? <Ban className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              {isActive ? 'Suspend account' : 'Reactivate account'}
              <span className="ml-auto text-xs font-normal opacity-70">
                {isActive ? 'Locks them out until resolved' : 'Restores access'}
              </span>
            </button>

            <button
              onClick={() => setConfirmingDelete(true)}
              className="w-full flex items-center gap-3 bg-red-50 text-red-600 rounded-2xl px-4 py-3.5 text-left font-bold text-sm"
            >
              <Trash2 className="w-4 h-4" />
              Delete permanently
              <span className="ml-auto text-xs font-normal opacity-70">Cannot be undone</span>
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-start gap-2 bg-red-50 rounded-2xl p-4 mb-4">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-xs leading-relaxed">
                This permanently erases {member.full_name}'s account. This only works if they
                have no contributions, withdrawals, or other activity — accounts with real
                history can't be deleted, only suspended. Type their full name to confirm.
              </p>
            </div>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={member.full_name}
              className="w-full border border-red-200 rounded-xl px-4 py-3 text-sm text-green-900 mb-3 focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <div className="flex gap-2">
              <button onClick={() => { setConfirmingDelete(false); setConfirmText('') }} className="flex-1 border border-green-200 text-green-700 font-bold text-sm rounded-full py-3">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={!nameMatches || deleteMutation.isPending}
                className="flex-1 bg-red-600 text-white font-bold text-sm rounded-full py-3 disabled:opacity-40"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}
