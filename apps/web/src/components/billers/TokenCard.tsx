import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Copy, Square, Volume2 } from 'lucide-react'
import toast from '@/lib/notify'
import { brandGradient, rgba, type BillerBrand } from '@/lib/billerBrand'
import { groupToken, tokenToSpeech } from '@/lib/billCatalog'
import { speak, speechSupported, stopSpeaking } from '@/lib/speech'

/**
 * The thing the customer actually came for: the token. Big grouped digits that
 * are easy to copy or write down, and a "Read out" button that speaks them slowly,
 * four digits at a time. The speaker icon wobbles and bounces while idle so it
 * gets noticed, and shows sound waves while it is talking.
 */
export function TokenCard({ token, label = 'Your token', brand }: { token: string; label?: string; brand?: BillerBrand | null }) {
  const reduce = useReducedMotion()
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const stopRef = useRef<() => void>(() => {})
  const canSpeak = speechSupported()
  const main = brand?.main ?? '#14532d'
  const deep = brand?.deep ?? '#052e16'
  const groups = groupToken(token).split(' ')

  // Stop talking if the receipt is closed mid-sentence.
  useEffect(() => () => stopSpeaking(), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(token.replace(/\s+/g, ''))
      setCopied(true)
      toast.success('Token copied')
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      toast.error('Could not copy — press and hold the token to select it')
    }
  }

  function toggleSpeech() {
    if (speaking) { stopRef.current(); setSpeaking(false); return }
    stopRef.current = speak(`${label}. ${tokenToSpeech(token)}. Again. ${tokenToSpeech(token)}.`, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
    })
  }

  return (
    <div
      className="w-full rounded-2xl p-4 text-white relative overflow-hidden"
      style={{ background: brand ? brandGradient({ main, deep }) : `linear-gradient(135deg, ${main}, ${deep})`, boxShadow: `0 10px 30px ${rgba(main, 0.35)}`, color: brand?.on ?? '#fff' }}
    >
      <motion.span
        aria-hidden="true" className="absolute -top-10 -right-10 w-40 h-40 rounded-full"
        style={{ background: rgba('#ffffff', 0.14) }}
        animate={reduce ? undefined : { scale: [1, 1.18, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <p className="relative text-[11px] font-semibold uppercase tracking-widest opacity-80 mb-2">{label}</p>

      <div className="relative flex flex-wrap gap-x-3 gap-y-1.5 mb-4" aria-label={`Token ${groupToken(token)}`}>
        {groups.map((g, i) => (
          <motion.span
            key={`${g}-${i}`}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.07 }}
            className="font-mono text-[22px] leading-none font-extrabold tracking-wider"
          >
            {g}
          </motion.span>
        ))}
      </div>

      <div className="relative flex gap-2" data-html2canvas-ignore="true">
        <motion.button
          whileTap={{ scale: 0.95 }} onClick={copy}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold bg-white/20 backdrop-blur"
        >
          {copied ? <Check className="w-4 h-4" strokeWidth={3} /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy token'}
        </motion.button>

        {canSpeak && (
          <motion.button
            whileTap={{ scale: 0.95 }} onClick={toggleSpeech}
            aria-label={speaking ? 'Stop reading the token' : 'Read the token out loud'}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold bg-white text-green-950"
          >
            {speaking ? (
              <>
                <Square className="w-4 h-4 fill-current" />
                <span className="flex items-end gap-0.5 h-4" aria-hidden="true">
                  {[0, 1, 2, 3].map(i => (
                    <motion.span
                      key={i} className="w-0.5 rounded-full bg-green-900"
                      animate={{ height: ['30%', '100%', '30%'] }}
                      transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12 }}
                    />
                  ))}
                </span>
                Stop
              </>
            ) : (
              <>
                <motion.span
                  className="inline-flex"
                  animate={reduce ? undefined : { rotate: [0, -14, 14, -10, 10, 0], y: [0, -3, 0, -2, 0, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 2.2, ease: 'easeInOut' }}
                >
                  <Volume2 className="w-4 h-4" />
                </motion.span>
                Read out
              </>
            )}
          </motion.button>
        )}
      </div>
    </div>
  )
}
