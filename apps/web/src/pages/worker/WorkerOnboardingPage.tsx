import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ShieldCheck, User, Building2, MapPin, Lock, Copy, Check, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { copyToClipboard } from '@/lib/utils'

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT - Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
]

const POPULAR_BANKS = [
  'Access Bank', 'First Bank of Nigeria', 'Guaranty Trust Bank (GTBank)',
  'United Bank for Africa (UBA)', 'Zenith Bank', 'Kuda Bank', 'Opay', 'Palmpay',
  'Moniepoint MFB', 'Stanbic IBTC Bank', 'Sterling Bank', 'Fidelity Bank',
  'Union Bank', 'Wema Bank', 'Ecobank Nigeria', 'FCMB',
]

export default function WorkerOnboardingPage() {
  const navigate = useNavigate()
  const { user, setUser } = useAuthStore()

  const [fullName, setFullName] = useState(user?.full_name || '')
  const [stateOfResidence, setStateOfResidence] = useState(user?.state_of_residence || 'Lagos')
  const [bankName, setBankName] = useState(user?.bank_name || POPULAR_BANKS[0])
  const [customBank, setCustomBank] = useState('')
  const [accountNumber, setAccountNumber] = useState(user?.account_number || '')
  const [accountName, setAccountName] = useState(user?.account_name || '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)

  const referralCode = user?.referral_code || 'SW-XXXXXX'

  const handleCopyCode = async () => {
    await copyToClipboard(referralCode)
    setCopiedCode(true)
    toast.success('Referral code copied!')
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const effectiveBank = bankName === 'Other' ? customBank.trim() : bankName

  const isValid =
    fullName.trim().length >= 2 &&
    stateOfResidence &&
    effectiveBank.length >= 2 &&
    accountNumber.trim().length === 10 &&
    accountName.trim().length >= 2 &&
    newPassword.length >= 6 &&
    newPassword === confirmPassword

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return

    setLoading(true)
    try {
      const { data } = await api.post('/worker/profile/complete', {
        full_name: fullName.trim(),
        state_of_residence: stateOfResidence,
        bank_name: effectiveBank,
        account_number: accountNumber.trim(),
        account_name: accountName.trim(),
        new_password: newPassword,
      })

      // Update auth store with fresh user data
      setUser(data)
      toast.success('Profile completed successfully! Welcome to the team.')
      navigate('/worker/dashboard', { replace: true })
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-surface dark:bg-night-900 px-4 py-8 max-w-lg mx-auto w-full">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-gold/15 text-brand-gold-dark dark:text-brand-gold mb-1">
            <Sparkles className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-green-950 dark:text-white">
            Welcome to MonieKing
          </h1>
          <p className="text-sm text-green-700 dark:text-night-300">
            Complete your Service Worker profile to begin claiming jobs and earning instant commissions.
          </p>
        </div>

        {/* Referral Code Showcase */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-green-900 to-green-950 text-white shadow-lg space-y-2 border border-green-800">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-brand-gold">
              Your Unique Referral Code
            </span>
            <span className="text-[10px] bg-green-800/80 px-2 py-0.5 rounded-full text-green-200">
              Active
            </span>
          </div>
          <div className="flex items-center justify-between bg-black/30 p-2.5 rounded-xl border border-white/10">
            <span className="font-mono text-lg font-black tracking-widest text-white">
              {referralCode}
            </span>
            <button
              type="button"
              onClick={handleCopyCode}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-gold hover:bg-brand-gold-light text-green-950 rounded-lg text-xs font-bold transition-transform active:scale-95"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedCode ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[11px] text-green-300 leading-relaxed">
            Give this code to customers submitting manual requests (NIN, BVN, CAC, etc.). When they enter your code, their jobs prioritize to your attention and commissions track directly to your wallet!
          </p>
        </div>

        {/* Profile Completion Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Full Name */}
          <div>
            <label className="block text-xs font-bold text-green-900 dark:text-night-200 mb-1">
              Full Legal Name
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-3.5 w-4 h-4 text-green-600 dark:text-night-400" />
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Chinedu Okafor"
                className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-green-200 dark:border-night-700 bg-white dark:bg-night-800 text-green-950 dark:text-white text-sm outline-none focus:border-green-600 transition-colors"
              />
            </div>
          </div>

          {/* State of Residence */}
          <div>
            <label className="block text-xs font-bold text-green-900 dark:text-night-200 mb-1">
              State of Residence
            </label>
            <div className="relative">
              <MapPin className="absolute left-3.5 top-3.5 w-4 h-4 text-green-600 dark:text-night-400" />
              <select
                value={stateOfResidence}
                onChange={(e) => setStateOfResidence(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-green-200 dark:border-night-700 bg-white dark:bg-night-800 text-green-950 dark:text-white text-sm outline-none focus:border-green-600 transition-colors"
              >
                {NIGERIAN_STATES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Bank Details */}
          <div className="p-4 rounded-2xl bg-green-50/50 dark:bg-night-800 border border-green-100 dark:border-night-700 space-y-3">
            <div className="flex items-center gap-2 text-xs font-black text-green-900 dark:text-white uppercase tracking-wider">
              <Building2 className="w-4 h-4 text-green-700 dark:text-brand-gold" />
              Payout Bank Account
            </div>

            <div>
              <label className="block text-xs font-bold text-green-800 dark:text-night-300 mb-1">
                Bank Name
              </label>
              <select
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-green-200 dark:border-night-700 bg-white dark:bg-night-900 text-green-950 dark:text-white text-sm outline-none focus:border-green-600"
              >
                {POPULAR_BANKS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
                <option value="Other">Other Bank...</option>
              </select>
            </div>

            {bankName === 'Other' && (
              <div>
                <input
                  type="text"
                  required
                  value={customBank}
                  onChange={(e) => setCustomBank(e.target.value)}
                  placeholder="Enter Bank Name"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-green-200 dark:border-night-700 bg-white dark:bg-night-900 text-green-950 dark:text-white text-sm outline-none focus:border-green-600"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-green-800 dark:text-night-300 mb-1">
                10-Digit Account Number
              </label>
              <input
                type="text"
                required
                maxLength={10}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                placeholder="0123456789"
                className="w-full px-3.5 py-2.5 rounded-xl border border-green-200 dark:border-night-700 bg-white dark:bg-night-900 text-green-950 dark:text-white text-sm font-mono outline-none focus:border-green-600"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-green-800 dark:text-night-300 mb-1">
                Account Holder Name
              </label>
              <input
                type="text"
                required
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Exact name on your bank account"
                className="w-full px-3.5 py-2.5 rounded-xl border border-green-200 dark:border-night-700 bg-white dark:bg-night-900 text-green-950 dark:text-white text-sm outline-none focus:border-green-600"
              />
            </div>
          </div>

          {/* New Password */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-green-900 dark:text-night-200 mb-1">
                Set Personal Password (min. 6 characters)
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-green-600 dark:text-night-400" />
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New secure password"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-green-200 dark:border-night-700 bg-white dark:bg-night-800 text-green-950 dark:text-white text-sm outline-none focus:border-green-600 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-green-900 dark:text-night-200 mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-green-600 dark:text-night-400" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-type new password"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-green-200 dark:border-night-700 bg-white dark:bg-night-800 text-green-950 dark:text-white text-sm outline-none focus:border-green-600 transition-colors"
                />
              </div>
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-[11px] text-red-500 mt-1">Passwords do not match</p>
              )}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!isValid || loading}
            className="w-full py-3.5 px-4 rounded-xl bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-bold text-sm shadow-md transition-all active:scale-[0.99] flex items-center justify-center gap-2 mt-4"
          >
            {loading ? (
              <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                Complete Profile & Access Jobs
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  )
}
