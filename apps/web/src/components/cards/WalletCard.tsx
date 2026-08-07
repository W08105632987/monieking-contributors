import { useState } from 'react'
import { Eye, EyeOff, Copy } from 'lucide-react'
import { formatNaira, copyToClipboard } from '@/lib/utils'
import { Button } from '@/components/ui'
import type { Wallet } from '@/types'
import toast from 'react-hot-toast'

interface WalletCardProps {
  wallet: Wallet
  onFund?: () => void
  onWithdraw?: () => void
}

export function WalletCard({ wallet, onFund, onWithdraw }: WalletCardProps) {
  const [hidden, setHidden] = useState(false)

  const copy = async () => {
    const ok = await copyToClipboard(wallet.virtual_account_number ?? '')
    if (ok) toast.success('Account number copied!')
    else toast.error('Could not copy — try selecting it manually')
  }

  return (
    <div className="relative rounded-3xl overflow-hidden bg-hero-gradient shadow-card-lg p-5">
      {/* Decorative orbs */}
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-green-700/30 pointer-events-none" />
      <div className="absolute right-8 bottom-0    w-24 h-24 rounded-full bg-copper-400/10 pointer-events-none" />

      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <p className="text-green-400 text-xs font-semibold uppercase tracking-widest">Wallet balance</p>
          <button
            onClick={() => setHidden((h) => !h)}
            className="text-green-400 hover:text-green-300 transition-colors"
            aria-label={hidden ? 'Show balance' : 'Hide balance'}
          >
            {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <p className="text-white text-4xl font-extrabold tracking-tight mb-1">
          {hidden ? '₦••••••' : formatNaira(wallet.balance_kobo)}
        </p>
        <p className="text-green-400 text-xs mb-5">Available to use</p>

        {/* Virtual account */}
        {wallet.virtual_account_number && (
          <div className="bg-green-800/50 rounded-2xl p-3 mb-4">
            <p className="text-green-400 text-[10px] uppercase tracking-wide mb-1">
              Fund via — {wallet.virtual_account_bank}
            </p>
            <div className="flex items-center justify-between">
              <p className="text-white text-base font-bold tracking-widest">
                {wallet.virtual_account_number}
              </p>
              <button onClick={copy} className="text-copper-400 hover:text-copper-300 transition-colors" aria-label="Copy account number">
                <Copy size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="accent" size="sm" fullWidth onClick={onFund}>
            Fund wallet
          </Button>
          <Button
            variant="outline"
            size="sm"
            fullWidth
            onClick={onWithdraw}
            className="border-green-600 text-green-300 hover:bg-green-800/40"
          >
            Withdraw
          </Button>
        </div>
      </div>
    </div>
  )
}
