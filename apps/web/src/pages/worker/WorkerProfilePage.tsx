import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Phone, Mail, MapPin, Users,
  Building2, CreditCard,
  LogOut, ChevronRight, Eye, EyeOff,
  CheckCircle, Lock, Bell, Info, AlertTriangle,
  MessageCircle, Briefcase, Wallet, Copy, Check, Edit3, X,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { api, getErrorMessage } from '@/lib/api'
import { AvatarPicker } from '@/components/settings/AvatarPicker'
import { BiometricSection } from '@/components/settings/BiometricSection'
import { ChangePasswordSection } from '@/components/settings/ChangePasswordSection'
import { BankDetailsEditor } from '@/components/settings/BankDetailsEditor'
import { ContactSupportSheet } from '@/components/settings/ContactSupportSheet'
import { DarkModeToggle } from '@/components/settings/DarkModeToggle'

import { formatNaira, maskAccount, formatDate, copyToClipboard, cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { WorkerHeader } from '@/components/worker/WorkerHeader'

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT - Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
]

// ── Change withdrawal password sheet ─────────────────────────────
function ChangeWithdrawPasswordSheet({ onClose }: { onClose: () => void }) {
  const { user, setUser } = useAuthStore()
  const isFirstTimeSetup = !user?.has_withdrawal_password
  const [current, setCurrent] = useState('')
  const [newPwd, setNewPwd]   = useState('')
  const [confirm, setConfirm] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (newPwd.length < 8) { toast.error('New password must be at least 8 characters'); return }
    if (/^\d+$/.test(newPwd)) { toast.error("Withdrawal password can't be all numbers — add a letter or symbol"); return }
    if (newPwd !== confirm) { toast.error('Passwords do not match'); return }
    setLoading(true)
    try {
      if (!isFirstTimeSetup) {
        await api.post('/auth/verify-withdrawal-password', { withdrawal_password: current })
      }
      await api.post('/auth/set-withdrawal-password', { withdrawal_password: newPwd })
      if (user) setUser({ ...user, has_withdrawal_password: true })
      toast.success(isFirstTimeSetup ? 'Withdrawal password set' : 'Withdrawal password updated')
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-6" />
        <h2 className="text-green-900 dark:text-white font-extrabold text-xl mb-1">
          {isFirstTimeSetup ? 'Set withdrawal password' : 'Change withdrawal password'}
        </h2>
        <p className="text-green-500 dark:text-night-200 text-sm mb-6">This password authorises every withdrawal and payout request.</p>

        <div className="space-y-4 mb-6">
          {[
            ...(isFirstTimeSetup ? [] : [{ label: 'Current password', value: current, setter: setCurrent }]),
            { label: 'New password',          value: newPwd,   setter: setNewPwd },
            { label: 'Confirm new password',  value: confirm,  setter: setConfirm },
          ].map(({ label, value, setter }) => (
            <div key={label}>
              <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">{label}</label>
              <div className="relative">
                <input
                  type={showAll ? 'text' : 'password'}
                  value={value}
                  onChange={e => setter(e.target.value)}
                  placeholder="••••••••"
                  className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm text-green-900 dark:text-white bg-white dark:bg-night-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent pr-10"
                />
                <button type="button" onClick={() => setShowAll(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 dark:text-night-300">
                  {showAll ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || (!isFirstTimeSetup && !current) || !newPwd || !confirm}
          className="w-full bg-green-900 dark:bg-night-100 text-white dark:text-night-900 font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-50"
        >
          {loading ? 'Updating…' : 'Update withdrawal password'}
        </button>
      </motion.div>
    </div>
  )
}

// ── Edit personal information sheet ──────────────────────────────
function EditPersonalInfoSheet({ onClose }: { onClose: () => void }) {
  const { user, setUser } = useAuthStore()
  const [stateOfResidence, setStateOfResidence] = useState(user?.state_of_residence || '')
  const [email, setEmail] = useState(user?.email || '')
  const [nextOfKinName, setNextOfKinName] = useState(user?.next_of_kin_name || '')
  const [nextOfKinPhone, setNextOfKinPhone] = useState(user?.next_of_kin_phone || '')
  const [loading, setLoading] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const payload: Record<string, any> = {
        state_of_residence: stateOfResidence || null,
        email: email ? email.trim() : null,
        next_of_kin_name: nextOfKinName ? nextOfKinName.trim() : null,
        next_of_kin_phone: nextOfKinPhone ? nextOfKinPhone.trim() : null,
      }
      const { data } = await api.patch('/users/me', payload)
      if (user) {
        setUser({
          ...user,
          state_of_residence: data.state_of_residence,
          email: data.email,
          next_of_kin_name: data.next_of_kin_name,
          next_of_kin_phone: data.next_of_kin_phone,
        })
      }
      toast.success('Worker details updated successfully')
      onClose()
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-green-900 dark:text-white font-extrabold text-xl">Edit Worker Info</h2>
          <button onClick={onClose} className="p-1 rounded-full text-green-700 dark:text-night-300 hover:bg-green-50 dark:hover:bg-night-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">
              State of Residence
            </label>
            <select
              value={stateOfResidence}
              onChange={e => setStateOfResidence(e.target.value)}
              className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm text-green-900 dark:text-white bg-white dark:bg-night-700 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">Select state...</option>
              {NIGERIAN_STATES.map(st => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="worker@example.com"
              className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm text-green-900 dark:text-white bg-white dark:bg-night-700 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">
              Next of Kin Full Name
            </label>
            <input
              type="text"
              value={nextOfKinName}
              onChange={e => setNextOfKinName(e.target.value)}
              placeholder="e.g. Mary Okafor"
              className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm text-green-900 dark:text-white bg-white dark:bg-night-700 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">
              Next of Kin Phone Number
            </label>
            <input
              type="tel"
              value={nextOfKinPhone}
              onChange={e => setNextOfKinPhone(e.target.value)}
              placeholder="08012345678"
              className="w-full border border-green-200 dark:border-night-500 rounded-xl px-4 py-3 text-sm text-green-900 dark:text-white bg-white dark:bg-night-700 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 bg-green-900 dark:bg-brand-gold dark:text-green-950 text-white font-bold text-sm rounded-full py-4 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}

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
      <div className="absolute inset-0 bg-green-950/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="relative bg-white dark:bg-night-700 rounded-t-3xl w-full max-w-lg p-6 pb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-green-200 dark:bg-night-500 rounded-full mx-auto mb-6" />
        <div className="w-14 h-14 bg-red-50 dark:bg-red-900/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <LogOut className="w-7 h-7 text-red-500 dark:text-red-400" />
        </div>
        <h2 className="text-green-900 dark:text-white font-extrabold text-xl text-center mb-1">Sign out?</h2>
        <p className="text-green-500 dark:text-night-200 text-sm text-center mb-8">
          You will need to sign back in to access your service worker account and job pool.
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
            className="flex-1 bg-red-500 text-white font-bold text-sm rounded-full py-3.5 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? 'Signing out…' : 'Yes, sign out'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Profile section row ───────────────────────────────────────────
function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-green-50 dark:border-night-600 last:border-0">
      <div className="w-8 h-8 bg-green-50 dark:bg-night-600 rounded-xl flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-green-500 dark:text-night-200" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-green-400 dark:text-night-300 text-xs font-medium">{label}</p>
        <p className="text-green-900 dark:text-white text-sm font-semibold truncate">{value}</p>
      </div>
    </div>
  )
}

// ── Menu row ─────────────────────────────────────────────────────
function MenuRow({
  icon: Icon,
  label,
  sublabel,
  onClick,
  danger = false,
  iconBg = 'bg-green-50 dark:bg-night-600',
  iconColor = 'text-green-500 dark:text-night-200',
}: {
  icon: any
  label: string
  sublabel?: string
  onClick: () => void
  danger?: boolean
  iconBg?: string
  iconColor?: string
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 py-3.5 border-b border-green-50 dark:border-night-600 last:border-0 active:bg-green-50/50 dark:active:bg-white/5 transition-all text-left"
    >
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', iconBg)}>
        <Icon className={cn('w-4 h-4', iconColor)} />
      </div>
      <div className="flex-1">
        <p className={cn('text-sm font-semibold', danger ? 'text-red-500 dark:text-red-300' : 'text-green-900 dark:text-white')}>{label}</p>
        {sublabel && <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{sublabel}</p>}
      </div>
      <ChevronRight className={cn('w-4 h-4 flex-shrink-0', danger ? 'text-red-300' : 'text-green-300 dark:text-night-300')} />
    </button>
  )
}

// ── Main WorkerProfilePage ─────────────────────────────────────────
export default function WorkerProfilePage() {
  const navigate = useNavigate()
  const { user, setUser } = useAuthStore()
  const qc = useQueryClient()
  const [showWithdrawSheet, setShowWithdrawSheet] = useState(false)
  const [showEditInfoSheet, setShowEditInfoSheet] = useState(false)
  const [showSignOutSheet, setShowSignOutSheet] = useState(false)
  const [showContactSheet, setShowContactSheet] = useState(false)

  const [copiedCode, setCopiedCode] = useState(false)

  // Earnings summary query
  const { data: summary } = useQuery({
    queryKey: ['worker-earnings-summary'],
    queryFn: async () => {
      const res = await api.get('/worker/earnings/summary')
      return res.data
    },
  })

  if (!user) return null

  const commissionBalanceKobo = summary?.commission_balance_kobo ?? user?.commission_balance_kobo ?? 0
  const lifetimeEarnedKobo = summary?.lifetime_earned_kobo ?? 0
  const jobsCompletedCount = summary?.jobs_completed ?? 0

  const handleCopyReferral = async () => {
    if (!user.referral_code) return
    const ok = await copyToClipboard(user.referral_code)
    if (ok) {
      setCopiedCode(true)
      toast.success('Referral code copied to clipboard!')
      setTimeout(() => setCopiedCode(false), 2500)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <WorkerHeader title="My Profile" subtitle="Service Worker" />

      <div className="flex-1 overflow-y-auto pb-safe-nav px-4">
        {/* Avatar + name hero */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center py-6 mb-2"
        >
          <AvatarPicker
            name={user.full_name}
            avatarUrl={user.avatar_url}
            onUploaded={(newUrl) => {
              setUser({ ...user, avatar_url: newUrl })
              qc.invalidateQueries({ queryKey: ['me'] })
            }}
          />
          <h1 className="text-green-900 dark:text-white text-xl font-extrabold text-center mt-3">
            {user.full_name}
          </h1>
          <p className="text-green-500 dark:text-night-200 text-sm mt-0.5 font-medium">
            {user.phone_number}
          </p>

          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 text-green-500 dark:text-night-200" />
              <span className="text-green-500 dark:text-night-200 text-xs font-medium">
                {user.status === 'active' ? 'Active Service Worker' : user.status}
              </span>
            </div>
            {user.state_of_residence && (
              <>
                <span className="text-green-200 dark:text-night-400 text-xs">·</span>
                <span className="text-xs font-semibold text-green-600 dark:text-night-200 flex items-center gap-0.5">
                  <MapPin className="w-3 h-3 inline" /> {user.state_of_residence}
                </span>
              </>
            )}
          </div>

          <p className="text-green-300 dark:text-night-300 text-xs mt-1">
            Worker since {formatDate(user.created_at)}
          </p>
        </motion.div>

        {/* Worker Referral Code Card */}
        {user.referral_code && (
          <div className="rounded-2xl p-4 mb-4 bg-gradient-to-br from-green-900 to-green-950 text-white shadow-card border border-green-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-extrabold tracking-wider text-amber-400">
                Your Referral Code
              </span>
              <span className="text-[10px] bg-green-800/80 px-2 py-0.5 rounded-full text-green-200 font-semibold">
                Permanent
              </span>
            </div>
            <div className="flex items-center justify-between bg-black/30 p-2.5 rounded-xl border border-white/10">
              <span className="font-mono text-base font-black tracking-widest text-white">
                {user.referral_code}
              </span>
              <button
                type="button"
                onClick={handleCopyReferral}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-green-950 rounded-lg text-xs font-bold transition-transform active:scale-95 shadow"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedCode ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-[11px] text-green-300 mt-2 leading-relaxed">
              When customers input your code for manual NIN, BVN, or verification jobs, their requests prioritize to your queue and earnings credit straight to you!
            </p>
          </div>
        )}

        {/* Commission Wallet & Stats summary */}
        <div
          className="rounded-2xl p-4 mb-4 text-white shadow-card"
          style={{ background: 'linear-gradient(135deg, #052E16 0%, #064E3B 100%)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-green-300 text-xs font-semibold uppercase tracking-wider">
                Commission Balance
              </p>
              <p className="text-2xl font-black mt-0.5 text-white">
                {formatNaira(commissionBalanceKobo)}
              </p>
              {((summary?.commission_held_kobo ?? 0) > 0 || (summary?.commission_debt_kobo ?? 0) > 0) && (
                <p className="text-[11px] text-amber-300 mt-1">
                  {(summary?.commission_held_kobo ?? 0) > 0 && `${formatNaira(summary?.commission_held_kobo ?? 0)} held`}
                  {(summary?.commission_held_kobo ?? 0) > 0 && (summary?.commission_debt_kobo ?? 0) > 0 && ' · '}
                  {(summary?.commission_debt_kobo ?? 0) > 0 && `${formatNaira(summary?.commission_debt_kobo ?? 0)} owed`}
                </p>
              )}
            </div>
            <button
              onClick={() => navigate('/worker/earnings')}
              className="bg-amber-400 hover:bg-amber-300 text-green-950 font-bold text-xs rounded-full px-4 py-2 active:scale-95 transition-all shadow"
            >
              Request Payout
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-3 border-t border-green-800/80 text-xs">
            <div className="bg-green-950/40 rounded-xl p-2.5 border border-green-800/40">
              <p className="text-green-300 font-medium">Lifetime Earned</p>
              <p className="text-white font-bold text-sm mt-0.5">
                {formatNaira(lifetimeEarnedKobo)}
              </p>
            </div>
            <div className="bg-green-950/40 rounded-xl p-2.5 border border-green-800/40">
              <p className="text-green-300 font-medium">Jobs Completed</p>
              <p className="text-white font-bold text-sm mt-0.5">
                {jobsCompletedCount} successful
              </p>
            </div>
          </div>
        </div>

        {/* Personal & Worker Information Card */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4 mb-4">
          <div className="flex items-center justify-between pt-4 pb-2">
            <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-widest">
              Personal Information
            </p>
            <button
              onClick={() => setShowEditInfoSheet(true)}
              className="flex items-center gap-1 text-xs font-bold text-green-700 dark:text-brand-gold hover:underline"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Edit details
            </button>
          </div>

          <InfoRow icon={User}   label="Full legal name"    value={user.full_name} />
          <InfoRow icon={Phone}  label="Phone number"       value={user.phone_number} />
          <InfoRow icon={MapPin} label="State of residence" value={user.state_of_residence ?? 'Not specified'} />
          <InfoRow icon={Mail}   label="Email address"      value={user.email ?? 'Not linked'} />
          <InfoRow icon={Users}  label="Next of kin"        value={user.next_of_kin_name ?? '—'} />
          <InfoRow icon={Phone}  label="Next of kin phone"  value={user.next_of_kin_phone ?? '—'} />

          {/* Bank Details section merged inside */}
          <div className="border-t border-green-100 dark:border-night-500 mt-2">
            <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-widest pt-4 pb-2">
              Payout Bank Account
            </p>
            <InfoRow icon={Building2}  label="Bank name"      value={user.bank_name ?? '—'} />
            <InfoRow icon={CreditCard} label="Account number" value={user.account_number ? maskAccount(user.account_number) : '—'} />
            <InfoRow icon={User}       label="Account name"   value={user.account_name ?? '—'} />

            <BankDetailsEditor
              currentBankName={user.bank_name}
              currentAccountNumber={user.account_number}
              currentAccountName={user.account_name}
              onUpdated={(details) => setUser({ ...user, ...details })}
              isLast
            />
          </div>
        </div>

        {/* Work & Operations quick navigation */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4 mb-4">
          <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-widest pt-4 pb-2">
            Work & Operations
          </p>
          <MenuRow
            icon={Briefcase}
            label="Service Job Pool"
            sublabel="Claim and complete customer verification jobs"
            iconBg="bg-green-100 dark:bg-night-600"
            iconColor="text-green-700 dark:text-night-100"
            onClick={() => navigate('/worker/dashboard')}
          />
          <MenuRow
            icon={Wallet}
            label="Earnings & Payouts"
            sublabel="Commission history and withdrawal requests"
            iconBg="bg-amber-50 dark:bg-amber-500/10"
            iconColor="text-amber-500 dark:text-amber-300"
            onClick={() => navigate('/worker/earnings')}
          />
          <MenuRow
            icon={AlertTriangle}
            label="Job Disputes"
            sublabel="View any reported or escalated tasks"
            iconBg="bg-red-50 dark:bg-red-900/20"
            iconColor="text-red-400 dark:text-red-300"
            onClick={() => navigate('/worker/disputes')}
          />
          <div className="pb-2" />
        </div>

        {/* Security & Credentials */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4 mb-4">
          <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-widest pt-4 pb-2">
            Security & Access
          </p>
          <MenuRow
            icon={Lock}
            label="Change withdrawal password"
            sublabel="Authorises commission payouts and bank updates"
            iconBg="bg-amber-50 dark:bg-amber-500/10"
            iconColor="text-amber-500 dark:text-amber-300"
            onClick={() => setShowWithdrawSheet(true)}
          />
          <ChangePasswordSection />
          <BiometricSection />
          <div className="pb-2" />
        </div>

        {/* Preferences & Support */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4 mb-4">
          <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-widest pt-4 pb-2">
            Preferences & Support
          </p>
          <DarkModeToggle />
          <MenuRow
            icon={Bell}
            label="Notification settings"
            sublabel="Manage job alerts and payout updates"
            onClick={() => toast('Instant SMS and push alerts are active for all claimed jobs')}
          />
          <MenuRow
            icon={MessageCircle}
            label="Contact Support"
            sublabel="Reach MonieKing administration directly"
            iconBg="bg-green-100 dark:bg-night-600"
            iconColor="text-green-700 dark:text-night-100"
            onClick={() => setShowContactSheet(true)}
          />
          <MenuRow
            icon={Info}
            label="About MonieKing"
            sublabel="Version 1.0.0 · Service Worker Network"
            onClick={() => window.open('https://monieking.com', '_blank')}
          />
          <div className="pb-2" />
        </div>

        {/* Sign Out Card */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-red-100 dark:border-red-950/40 shadow-card px-4 mb-6">
          <MenuRow
            icon={LogOut}
            label="Sign out"
            sublabel="You will need your phone and password to sign back in"
            danger
            iconBg="bg-red-50 dark:bg-red-900/20"
            iconColor="text-red-500 dark:text-red-300"
            onClick={() => setShowSignOutSheet(true)}
          />
        </div>

        {/* Footer */}
        <p className="text-center text-green-300 dark:text-night-300 text-xs pb-4">
          MonieKing Service Worker Portal · All rights reserved
        </p>
      </div>

      {/* Sheets & Modals */}
      <AnimatePresence>
        {showWithdrawSheet && (
          <ChangeWithdrawPasswordSheet onClose={() => setShowWithdrawSheet(false)} />
        )}
        {showEditInfoSheet && (
          <EditPersonalInfoSheet onClose={() => setShowEditInfoSheet(false)} />
        )}
        {showSignOutSheet && (
          <SignOutSheet onClose={() => setShowSignOutSheet(false)} />
        )}
        <ContactSupportSheet open={showContactSheet} onClose={() => setShowContactSheet(false)} />
      </AnimatePresence>


    </div>
  )
}
