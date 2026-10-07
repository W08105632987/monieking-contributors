import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Phone, Users,
  LogOut, ChevronRight, Eye, EyeOff,
  CheckCircle, Lock, Bell, Info, AlertTriangle, History,
  MessageCircle,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { useWallet } from '@/hooks/useWallet'
import { api } from '@/lib/api'
import { AvatarPicker } from '@/components/settings/AvatarPicker'
import { BiometricSection } from '@/components/settings/BiometricSection'
import { ChangePasswordSection } from '@/components/settings/ChangePasswordSection'
import { BankDetailsEditor } from '@/components/settings/BankDetailsEditor'
import { KycSection } from '@/components/settings/KycSection'
import { ContactSupportSheet } from '@/components/settings/ContactSupportSheet'
import { DarkModeToggle } from '@/components/settings/DarkModeToggle'
import { NotificationSoundRow } from '@/components/settings/NotificationSoundRow'

import { formatNaira, formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'

// ── Change withdrawal password sheet ─────────────────────────────
function ChangeWithdrawPasswordSheet({ onClose }: { onClose: () => void }) {
  const { user, setUser } = useAuthStore()
  const isFirstTimeSetup = !user?.has_withdrawal_password
  const [current, setCurrent]   = useState('')
  const [newPwd, setNewPwd]     = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showAll, setShowAll]   = useState(false)
  const [loading, setLoading]   = useState(false)

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
        <p className="text-green-500 dark:text-night-200 text-sm mb-6">This password authorises every withdrawal you make.</p>

        <div className="space-y-4 mb-6">
          {[
            ...(isFirstTimeSetup ? [] : [{ label: 'Current password', value: current, setter: setCurrent }]),
            { label: 'New password',      value: newPwd,   setter: setNewPwd },
            { label: 'Confirm new password', value: confirm, setter: setConfirm },
          ].map(({ label, value, setter }) => (
            <div key={label}>
              <label className="text-green-700 dark:text-night-100 text-xs font-bold uppercase tracking-wide block mb-1.5">{label}</label>
              <div className="relative">
                <input
                  type={showAll ? 'text' : 'password'}
                  value={value}
                  onChange={e => setter(e.target.value)}
                  placeholder="••••••"
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
          <LogOut className="w-7 h-7 text-red-400 dark:text-red-300" />
        </div>
        <h2 className="text-green-900 dark:text-white font-extrabold text-xl text-center mb-1">Sign out?</h2>
        <p className="text-green-500 dark:text-night-200 text-sm text-center mb-8">
          You will need to sign back in to access your account.
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
        <p className={cn('text-sm font-semibold', danger ? 'text-red-500' : 'text-green-900 dark:text-white')}>{label}</p>
        {sublabel && <p className="text-green-400 dark:text-night-300 text-xs mt-0.5">{sublabel}</p>}
      </div>
      <ChevronRight className={cn('w-4 h-4 flex-shrink-0', danger ? 'text-red-300' : 'text-green-300 dark:text-night-300')} />
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export default function ProfilePage() {
  const navigate  = useNavigate()
  const { user, setUser }  = useAuthStore()
  const qc = useQueryClient()
  const { wallet } = useWallet()
  const [showWithdrawSheet, setShowWithdrawSheet] = useState(false)
  const [showSignOutSheet, setShowSignOutSheet]   = useState(false)
  const [showContactSheet, setShowContactSheet]   = useState(false)


  const { data: smsFee } = useQuery({
    queryKey: ['sms-fee'],
    queryFn: async () => {
      const { data } = await api.get<{ monthly_sms_fee_kobo: number; monthly_sms_fee_naira: number }>('/settings/sms-fee')
      return data
    },
  })

  const toggleSmsMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      return await api.patch(`/users/${user!.id}/sms-alerts`, { enabled })
    },
    onSuccess: (_, enabled) => {
      toast.success(enabled ? 'SMS alerts activated' : 'SMS alerts deactivated')
      if (user) setUser({ ...user, sms_alerts_enabled: enabled })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (err: unknown) => toast.error((err as any)?.response?.data?.detail ?? 'Failed to update SMS settings'),
  })

  if (!user) return null

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">

      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-night-800">
        <BrandBlobLogo height={36} />
      </header>

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
              qc.invalidateQueries({ queryKey: ['all-customers'] })
              qc.invalidateQueries({ queryKey: ['director-withdrawals'] })
            }}
          />
          <h1 className="text-green-900 dark:text-white text-xl font-extrabold text-center mt-3">{user.full_name}</h1>
          <p className="text-green-500 dark:text-night-200 text-sm mt-0.5">{user.phone_number}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <CheckCircle className="w-3.5 h-3.5 text-green-500 dark:text-night-200" />
            <span className="text-green-500 dark:text-night-200 text-xs font-medium">
              {user.status === 'active' ? 'Active account' : user.status}
            </span>
          </div>
          <p className="text-green-300 dark:text-night-300 text-xs mt-1">
            Member since {formatDate(user.created_at)}
          </p>
        </motion.div>

        {/* Wallet summary pill */}
        {wallet && (
          <div
            className="rounded-2xl p-4 mb-4 flex items-center justify-between bg-hero-gradient dark:bg-night-gradient"
          >
            <div>
              <p className="text-green-400 dark:text-night-300 text-xs font-semibold uppercase tracking-wide">Wallet balance</p>
              <p className="text-white text-xl font-extrabold">{formatNaira(wallet.balance_kobo)}</p>
            </div>
            <button
              onClick={() => navigate('/customer/wallet')}
              className="bg-amber-400 text-green-900 dark:text-white font-bold text-xs rounded-full px-4 py-2 active:scale-95 transition-all"
            >
              View wallet
            </button>
          </div>
        )}

        {/* Personal information, identity verification, and bank
            details — merged into ONE grouped card with divider lines
            between each subsection, instead of three separate floating
            cards (which is what KycSection/BankDetailsEditor render on
            their own by default — their own outer card wrapper was
            removed specifically so they'd nest inside this one). */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4 mb-4">
          <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-widest pt-4 pb-2">Personal information</p>
          <InfoRow icon={User}     label="Full name"      value={user.full_name} />
          <InfoRow icon={Phone}    label="Phone number"   value={user.phone_number} />
          <InfoRow icon={Users}    label="Next of kin"    value={user.next_of_kin_name ?? '—'} />
          <InfoRow icon={Phone}    label="Next of kin phone" value={user.next_of_kin_phone ?? '—'} />

          <div className="border-t border-green-100 dark:border-night-500 mt-2">
            <KycSection
              bvnLinked={user.bvn_linked ?? false}
              ninLinked={user.nin_linked ?? false}
              bvnLast4={user.bvn_last4 ?? null}
              ninLast4={user.nin_last4 ?? null}
              hasVirtualAccount={!!wallet?.virtual_account_number}
              onVerified={(fields) => {
                setUser({ ...user, bvn_linked: fields.bvnLinked, nin_linked: fields.ninLinked, bvn_last4: fields.bvnLast4, nin_last4: fields.ninLast4 })
                qc.invalidateQueries({ queryKey: ['wallet'] })
              }}
            />
            <BankDetailsEditor
              currentBankName={user.bank_name}
              currentAccountNumber={user.account_number}
              currentAccountName={user.account_name}
              onUpdated={(details) => setUser({ ...user, ...details })}
            />
          </div>
        </div>

        {/* Security */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4 mb-4">
          <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-widest pt-4 pb-2">Security</p>
          <MenuRow
            icon={Lock}
            label="Change withdrawal password"
            sublabel="Update the password used to authorise withdrawals"
            iconBg="bg-amber-50 dark:bg-amber-500/10"
            iconColor="text-amber-500 dark:text-amber-300"
            onClick={() => setShowWithdrawSheet(true)}
          />
          <ChangePasswordSection />
          <BiometricSection />
          <div className="pb-2" />
        </div>

        {/* Support */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4 mb-4">
          <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-widest pt-4 pb-2">Support</p>
          <MenuRow
            icon={History}
            label="Service history"
            sublabel="NIN, BVN, TIN & other verification requests"
            iconBg="bg-green-100 dark:bg-night-600"
            iconColor="text-green-700 dark:text-night-100"
            onClick={() => navigate('/customer/services/history')}
          />
          <MenuRow
            icon={AlertTriangle}
            label="My Disputes"
            sublabel="Track anything you've reported"
            iconBg="bg-red-50 dark:bg-red-900/20"
            iconColor="text-red-400 dark:text-red-300"
            onClick={() => navigate('/customer/disputes')}
          />
          <MenuRow
            icon={MessageCircle}
            label="Contact"
            sublabel="Reach us on WhatsApp or by email"
            iconBg="bg-green-100 dark:bg-night-600"
            iconColor="text-green-700 dark:text-night-100"
            onClick={() => setShowContactSheet(true)}
          />
          <div className="pb-2" />
        </div>

        {/* Preferences */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4 mb-4">
          <p className="text-green-500 dark:text-night-200 text-xs font-bold uppercase tracking-widest pt-4 pb-2">Preferences</p>
          <DarkModeToggle />

          {/* SMS Transaction Alerts Toggle Row */}
          <div className="flex items-center justify-between py-3.5 border-b border-green-100 dark:border-night-500">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                <Bell className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-green-900 dark:text-white truncate">
                    SMS Transaction Alerts
                  </p>
                  {user.sms_alerts_enabled ? (
                    <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 shrink-0">
                      Active
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 dark:bg-night-600 dark:text-zinc-400 shrink-0">
                      Off
                    </span>
                  )}
                </div>
                <p className="text-xs text-green-500 dark:text-night-200 mt-0.5">
                  {smsFee ? `₦${(smsFee.monthly_sms_fee_kobo / 100).toLocaleString()} / month` : 'Monthly subscription'} · Instant alerts
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={toggleSmsMutation.isPending}
              onClick={() => toggleSmsMutation.mutate(!user.sms_alerts_enabled)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                user.sms_alerts_enabled ? "bg-amber-500" : "bg-zinc-300 dark:bg-night-500",
                toggleSmsMutation.isPending && "opacity-50 cursor-not-allowed"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                  user.sms_alerts_enabled ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>

          <NotificationSoundRow />

          <MenuRow
            icon={Bell}
            label="Notification center"
            sublabel="View all your past transaction alerts"
            onClick={() => navigate('/customer/notifications')}
          />
          <MenuRow
            icon={Info}
            label="About MonieKing"
            sublabel="Version 1.0.0"
            onClick={() => window.open('https://monieking.com', '_blank')}
          />
          <div className="pb-2" />
        </div>

        {/* Sign out */}
        <div className="bg-white dark:bg-night-700 rounded-2xl border border-red-100 shadow-card px-4 mb-6">
          <MenuRow
            icon={LogOut}
            label="Sign out"
            sublabel="You will need to sign back in"
            danger
            iconBg="bg-red-50 dark:bg-red-900/20"
            iconColor="text-red-400 dark:text-red-300"
            onClick={() => setShowSignOutSheet(true)}
          />
        </div>

        {/* Footer */}
        <p className="text-center text-green-300 dark:text-night-300 text-xs pb-4">
          MonieKing Contributors · All rights reserved
        </p>
      </div>

      <AnimatePresence>
        {showWithdrawSheet && <ChangeWithdrawPasswordSheet onClose={() => setShowWithdrawSheet(false)} />}
        {showSignOutSheet  && <SignOutSheet onClose={() => setShowSignOutSheet(false)} />}
        <ContactSupportSheet open={showContactSheet} onClose={() => setShowContactSheet(false)} />
      </AnimatePresence>


    </div>
  )
}