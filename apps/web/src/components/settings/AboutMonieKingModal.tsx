import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, ChevronLeft } from 'lucide-react'

interface AboutMonieKingModalProps {
  open: boolean
  onClose: () => void
}

// ── Custom on-brand illustrations ───────────────────────────────────
// Not stock photography — for a live app handling real money, hotlinking
// to random external image URLs is a reliability and licensing risk that
// isn't worth it. These are built to convey the same moments the brief
// asked for (a payment happening, a business growing, a family saving
// together, security) using the app's own green/amber palette instead.
// Swapping in licensed photography later just means swapping what each
// Section's `art` prop renders — the layout/overlay treatment stays.

function ArtPayment() {
  return (
    <svg viewBox="0 0 400 400" className="w-full h-full">
      <rect width="400" height="400" fill="#052E16" />
      <circle cx="320" cy="60" r="140" fill="#065F46" opacity="0.5" />
      <circle cx="40" cy="340" r="110" fill="#064E3B" opacity="0.5" />
      {/* Hand holding phone */}
      <rect x="150" y="120" width="110" height="200" rx="16" fill="#0F3D2E" stroke="#34D399" strokeWidth="2" />
      <rect x="162" y="140" width="86" height="130" rx="6" fill="#022C1B" />
      <circle cx="205" cy="290" r="8" fill="#34D399" />
      {/* Payment success check on screen */}
      <circle cx="205" cy="195" r="30" fill="#F59E0B" opacity="0.15" />
      <path d="M188 196l12 12 22-26" fill="none" stroke="#FBBF24" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      {/* Naira symbol floating */}
      <text x="290" y="150" fontSize="42" fontWeight="bold" fill="#FBBF24" opacity="0.9">₦</text>
      <text x="90" y="230" fontSize="28" fontWeight="bold" fill="#6EE7B7" opacity="0.5">₦</text>
      {/* Hand */}
      <path d="M120 340c10-30 30-45 40-45h20c8 0 12 8 8 16l-14 26" fill="#0F3D2E" stroke="#34D399" strokeWidth="2" />
    </svg>
  )
}

function ArtBusiness() {
  return (
    <svg viewBox="0 0 400 400" className="w-full h-full">
      <rect width="400" height="400" fill="#052E16" />
      <circle cx="60" cy="70" r="130" fill="#065F46" opacity="0.45" />
      {/* Storefront */}
      <rect x="70" y="180" width="260" height="140" rx="8" fill="#0F3D2E" stroke="#34D399" strokeWidth="2" />
      <rect x="90" y="140" width="220" height="45" rx="6" fill="#F59E0B" opacity="0.85" />
      <rect x="110" y="220" width="60" height="100" fill="#022C1B" />
      <rect x="230" y="220" width="60" height="60" fill="#022C1B" />
      <rect x="180" y="220" width="35" height="60" fill="#022C1B" />
      {/* Growth chart overlay */}
      <polyline points="150,300 190,270 220,285 260,240 300,200" fill="none" stroke="#FBBF24" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="300" cy="200" r="7" fill="#FBBF24" />
      <text x="230" y="90" fontSize="30" fontWeight="bold" fill="#6EE7B7" opacity="0.6">₦</text>
    </svg>
  )
}

function ArtSecurity() {
  return (
    <svg viewBox="0 0 400 400" className="w-full h-full">
      <rect width="400" height="400" fill="#052E16" />
      <circle cx="340" cy="340" r="150" fill="#064E3B" opacity="0.5" />
      <path d="M200 90l90 32v78c0 70-42 118-90 138-48-20-90-68-90-138v-78z" fill="#0F3D2E" stroke="#34D399" strokeWidth="3" />
      <path d="M200 110l70 25v65c0 55-33 93-70 109-37-16-70-54-70-109v-65z" fill="#022C1B" />
      <path d="M175 200l18 18 34-38" fill="none" stroke="#FBBF24" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="90" cy="80" r="4" fill="#6EE7B7" opacity="0.7" />
      <circle cx="320" cy="120" r="5" fill="#FBBF24" opacity="0.6" />
      <circle cx="60" cy="300" r="4" fill="#6EE7B7" opacity="0.5" />
    </svg>
  )
}

function ArtCommunity() {
  return (
    <svg viewBox="0 0 400 400" className="w-full h-full">
      <rect width="400" height="400" fill="#052E16" />
      <circle cx="80" cy="320" r="140" fill="#065F46" opacity="0.45" />
      {/* Contribution card grid motif */}
      <g transform="translate(80,80)">
        <rect width="240" height="150" rx="18" fill="#0F3D2E" stroke="#34D399" strokeWidth="2" />
        {Array.from({ length: 5 }).flatMap((_, row) =>
          Array.from({ length: 9 }).map((_, col) => {
            const filled = (row * 9 + col) % 3 !== 0
            return (
              <rect
                key={`${row}-${col}`}
                x={16 + col * 24} y={40 + row * 20}
                width={18} height={14} rx={3}
                fill={filled ? '#FBBF24' : '#1C4F3D'}
                opacity={filled ? 0.9 : 0.6}
              />
            )
          })
        )}
      </g>
      <text x="140" y="330" fontSize="24" fontWeight="bold" fill="#6EE7B7" opacity="0.7">Day by day</text>
    </svg>
  )
}

function ArtWelcome() {
  return (
    <svg viewBox="0 0 400 400" className="w-full h-full">
      <rect width="400" height="400" fill="#052E16" />
      <circle cx="200" cy="150" r="170" fill="#065F46" opacity="0.4" />
      <circle cx="200" cy="200" r="70" fill="#F59E0B" opacity="0.15" />
      <text x="200" y="225" fontSize="90" fontWeight="bold" fill="#FBBF24" textAnchor="middle">₦</text>
      <circle cx="90" cy="90" r="5" fill="#6EE7B7" opacity="0.6" />
      <circle cx="320" cy="310" r="6" fill="#FBBF24" opacity="0.5" />
      <circle cx="330" cy="90" r="4" fill="#6EE7B7" opacity="0.5" />
    </svg>
  )
}

interface Section {
  art: () => JSX.Element
  eyebrow: string
  title: string
  body: React.ReactNode
}

const sections: Section[] = [
  {
    art: ArtWelcome,
    eyebrow: 'Welcome to',
    title: 'MonieKing',
    body: (
      <>
        <p>
          MonieKing is a contribution card savings platform built for daily,
          disciplined saving — the same principle as a traditional "ajo" or
          "esusu", now digital, trackable, and backed by a real financial
          infrastructure partner.
        </p>
        <p>
          Every card gives you 372 daily slots — 12 months mapped across 31
          days each — and you fill them at your own pace, on your own
          schedule.
        </p>
      </>
    ),
  },
  {
    art: ArtPayment,
    eyebrow: 'How it works',
    title: 'Contribute daily, your way',
    body: (
      <>
        <p>
          Fund your wallet, then post a contribution to any open day on your
          card. Do it yourself in the app, or hand cash to your assigned
          officer, who posts it on your behalf — either way, it's recorded
          against your card immediately.
        </p>
        <p>
          You choose between a <strong>Regular Card</strong> and a{' '}
          <strong>Food Card</strong>. A Food Card contributes toward
          December food distribution eligibility if completed by November
          30 — but its funds stay locked until then, or until you convert
          it to Regular (which permanently gives up that eligibility).
        </p>
      </>
    ),
  },
  {
    art: ArtCommunity,
    eyebrow: 'Flexibility',
    title: 'Your card, your timeline',
    body: (
      <>
        <p>
          A card completes automatically once all 372 days are filled. If
          you'd rather stop earlier, you can manually close a Regular Card
          any time — whatever you've contributed becomes withdrawable
          immediately, no need to wait.
        </p>
        <p>
          There's no fixed deadline for a Regular Card and no penalty for
          taking your time — the discipline is entirely on your terms.
        </p>
      </>
    ),
  },
  {
    art: ArtSecurity,
    eyebrow: 'Security',
    title: 'Built like it holds real money — because it does',
    body: (
      <>
        <p>
          Your session is protected by bank-grade httpOnly cookies, not
          browser storage a script could read. Sign in with your fingerprint
          if your device supports it, or your password — your choice, every
          time.
        </p>
        <p>
          Five wrong password attempts locks your account — 1 hour the first
          time, 3 hours if it happens again — and withdrawals require a
          separate withdrawal password on top of your login. Contributions
          land in individually generated virtual accounts through our
          licensed payment partner, not a shared pool.
        </p>
      </>
    ),
  },
  {
    art: ArtBusiness,
    eyebrow: 'The honest picture',
    title: 'What to weigh before you commit',
    body: (
      <>
        <p className="font-semibold text-amber-300 mb-1">Worth knowing:</p>
        <ul className="list-disc list-inside space-y-1 mb-3">
          <li>Structured, visual daily-saving discipline — you can see every day you've filled</li>
          <li>Officer-assisted cash contributions if you're not comfortable doing it all digitally</li>
          <li>Close a Regular Card early any time, funds available immediately</li>
        </ul>
        <p className="font-semibold text-amber-300 mb-1">Trade-offs:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Food Card funds are genuinely locked until completion or conversion — that's the deal, not a bug</li>
          <li>This is a savings structure, not an investment — your contributions don't earn interest</li>
          <li>Like any account holding money, you're trusting the platform and its payment partner to operate correctly</li>
        </ul>
      </>
    ),
  },
]

export function AboutMonieKingModal({ open, onClose }: AboutMonieKingModalProps) {
  const [index, setIndex] = useState(0)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(sections.length - 1, i))
    setIndex(clamped)
    scrollerRef.current?.children[clamped]?.scrollIntoView({ behavior: 'smooth', inline: 'start' })
  }

  const handleScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== index) setIndex(i)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-green-950"
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-20 w-9 h-9 bg-black/30 backdrop-blur-sm rounded-full flex items-center justify-center active:scale-95 transition-all"
          >
            <X className="w-5 h-5 text-white" />
          </button>

          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            className="h-full w-full flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
          >
            {sections.map((s, i) => (
              <div key={i} className="relative h-full w-full shrink-0 snap-start">
                <div className="absolute inset-0">
                  <s.art />
                  <div className="absolute inset-0 bg-gradient-to-t from-green-950 via-green-950/70 to-green-950/20" />
                </div>
                <div className="relative z-10 h-full flex flex-col justify-end px-6 pb-28">
                  <p className="text-amber-400 text-xs font-bold uppercase tracking-widest mb-2">{s.eyebrow}</p>
                  <h2 className="text-white text-2xl font-extrabold leading-tight mb-3">{s.title}</h2>
                  <div className="text-green-200 text-sm leading-relaxed space-y-2 max-h-[42vh] overflow-y-auto no-scrollbar pr-1">
                    {s.body}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination + nav */}
          <div className="absolute bottom-6 left-0 right-0 z-20 flex flex-col items-center gap-4 px-6">
            <div className="flex items-center gap-1.5">
              {sections.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-amber-400' : 'w-1.5 bg-white/30'}`}
                  aria-label={`Go to section ${i + 1}`}
                />
              ))}
            </div>
            <div className="flex items-center justify-between w-full">
              <button
                onClick={() => goTo(index - 1)}
                disabled={index === 0}
                className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center disabled:opacity-30 active:scale-95 transition-all"
              >
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
              {index === sections.length - 1 ? (
                <button
                  onClick={onClose}
                  className="px-6 h-10 rounded-full bg-amber-400 text-green-900 font-bold text-sm active:scale-95 transition-all"
                >
                  Got it
                </button>
              ) : (
                <button
                  onClick={() => goTo(index + 1)}
                  className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-all"
                >
                  <ChevronRight className="w-5 h-5 text-white" />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
