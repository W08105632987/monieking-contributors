import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, LogOut, Shield, Info } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { AvatarPicker } from '@/components/settings/AvatarPicker'
import { BiometricSection } from '@/components/settings/BiometricSection'
import { ChangePasswordSection } from '@/components/settings/ChangePasswordSection'

import { DarkModeToggle } from '@/components/settings/DarkModeToggle'
import { useState } from 'react'

// ── Sign out confirmation sheet ───────────────────────────────────
function SignOutSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { logout } = useAuthStore()
  const [loading, setLoading] = useState(false)

  const handleSignOut = async () => {
    setLoading(true)
    await api.post('/auth/logout').catch(() => {})
    logout()
    navigate('/auth/login', { replace: true })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 dark:bg-night-900/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-6" />
        <div className="w-14 h-14 bg-red-50 dark:bg-red-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <LogOut className="w-7 h-7 text-red-400 dark:text-red-300" />
        </div>
        <h2 className="text-green-900 dark:text-white font-extrabold text-xl text-center mb-1">Sign out?</h2>
        <p className="text-green-500 dark:text-night-200 text-sm text-center mb-8">
          You will need to sign back in to access your director account.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border-2 border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSignOut}
            disabled={loading}
            className="flex-1 bg-red-500 dark:bg-red-400 text-white font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? 'Signing out…' : 'Yes, sign out'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

export default function DirectorProfilePage() {
  const navigate = useNavigate()
  const { user, setUser } = useAuthStore()

  const [showSignOutSheet, setShowSignOutSheet] = useState(false)

  if (!user) return null

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Profile</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-6 text-center mb-4">
          <div className="flex justify-center mb-3">
            <AvatarPicker
              name={user.full_name}
              avatarUrl={user.avatar_url}
              onUploaded={(newUrl) => setUser({ ...user, avatar_url: newUrl })}
            />
          </div>
          <p className="text-green-900 dark:text-white font-extrabold text-lg">{user.full_name}</p>
          <p className="text-green-500 dark:text-night-200 text-sm">{user.phone_number}</p>
          <span className="inline-flex items-center gap-1 mt-2 text-xs font-bold bg-green-900 dark:bg-night-100 text-amber-400 dark:text-night-100 px-3 py-1 rounded-full">
            <Shield className="w-3 h-3" /> Director
          </span>
        </div>

        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4">
          <div className="flex justify-between text-sm py-1.5">
            <span className="text-green-500 dark:text-night-200">Joined</span>
            <span className="text-green-900 dark:text-white font-semibold">{formatDate(user.created_at)}</span>
          </div>
          <div className="flex justify-between text-sm py-1.5">
            <span className="text-green-500 dark:text-night-200">Status</span>
            <span className="text-green-900 dark:text-white font-semibold capitalize">{user.status}</span>
          </div>
        </div>

        <div className="mb-4">
          <BiometricSection />
        </div>

        <div className="mb-4">
          <ChangePasswordSection />
        </div>

        <div className="mb-4">
          <DarkModeToggle />
        </div>

        <button
          onClick={() => window.open('https://monieking.com', '_blank')}
          className="w-full flex items-center justify-center gap-2 border-2 border-green-200 dark:border-night-500 text-green-700 dark:text-night-100 font-bold text-sm rounded-2xl py-3.5 active:scale-95 transition-all mb-4"
        >
          <Info className="w-4 h-4" /> About MonieKing
        </button>

        <button
          onClick={() => setShowSignOutSheet(true)}
          className="w-full flex items-center justify-center gap-2 border-2 border-red-200 dark:border-red-900 text-red-500 dark:text-red-300 font-bold text-sm rounded-2xl py-3.5 active:scale-95 transition-all"
        >
          <LogOut className="w-4 h-4" /> Log out
        </button>
      </div>


      {showSignOutSheet && <SignOutSheet onClose={() => setShowSignOutSheet(false)} />}
    </div>
  )
}
