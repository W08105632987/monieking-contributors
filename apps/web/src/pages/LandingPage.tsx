import { Link } from 'react-router-dom'
import { ShieldCheck, Users, TrendingUp, Smartphone, ArrowRight, CheckCircle2 } from 'lucide-react'
import { Seo } from '@/components/seo/Seo'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'

const FEATURES = [
  {
    icon: Users,
    title: 'A digital officer network, just like traditional ajo',
    body: 'Zone officers collect contributions in person, the same trusted way esusu and thrift collection has always worked in Nigeria — now recorded instantly and safely on your phone.',
  },
  {
    icon: ShieldCheck,
    title: 'Bank-grade security on every contribution',
    body: 'Every card, every contribution, every withdrawal is tracked with full transaction records — no more paper cards that can be lost, torn, or disputed.',
  },
  {
    icon: TrendingUp,
    title: 'Food and regular contribution cards',
    body: 'Choose a daily food contribution card or a regular savings card — MonieKing supports both styles of contribution savings under one account.',
  },
  {
    icon: Smartphone,
    title: 'Airtime, data, and bill payments too',
    body: 'Top up airtime and data, pay electricity and cable TV bills, straight from your MonieKing wallet — one app for your daily contribution and your daily bills.',
  },
]

export default function LandingPage() {
  return (
    <>
      <Seo
        title="MonieKing — Digital Contribution Savings & Thrift Collection App Nigeria"
        description="MonieKing is Nigeria's digital contribution savings platform — a modern esusu and ajo alternative. Save daily with a trusted zone officer, track every contribution card online, and pay bills from your wallet."
        noindex={false}
      />

      {/* JSON-LD structured data — helps Google understand this as a
          real financial-services product, not just another page of
          text. Kept minimal and accurate; no invented review counts or
          ratings, since fabricated structured data is a fast way to
          get penalized rather than ranked. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'MonieKing',
            applicationCategory: 'FinanceApplication',
            operatingSystem: 'Web, Android, iOS',
            description: 'Digital contribution savings and thrift collection platform for Nigeria — a modern alternative to traditional ajo and esusu, with zone officers, contribution cards, and bill payments.',
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'NGN' },
          }),
        }}
      />

      <div className="min-h-screen bg-green-50 dark:bg-night-900">
        {/* Nav */}
        <header className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
          <BrandBlobLogo size={40} />
          <Link to="/auth/login" className="text-green-700 dark:text-night-100 font-semibold text-sm">
            Sign in
          </Link>
        </header>

        {/* Hero */}
        <section className="max-w-3xl mx-auto px-6 pt-10 pb-16 text-center">
          <h1 className="text-green-950 dark:text-white text-4xl sm:text-5xl font-extrabold tracking-tight mb-5">
            Your daily contribution savings, finally digital.
          </h1>
          <p className="text-green-600 dark:text-night-200 text-lg mb-8 max-w-xl mx-auto">
            MonieKing brings Nigeria's trusted ajo and esusu contribution model online — a zone officer you know,
            a contribution card you can track, and a wallet you can actually see grow.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/auth/register"
              className="inline-flex items-center gap-2 bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 font-bold rounded-2xl px-6 py-3.5"
            >
              Start saving today <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/auth/login"
              className="inline-flex items-center gap-2 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 text-green-900 dark:text-white font-bold rounded-2xl px-6 py-3.5"
            >
              Sign in
            </Link>
          </div>
        </section>

        {/* Features */}
        <section className="max-w-5xl mx-auto px-6 pb-20">
          <h2 className="sr-only">Why choose MonieKing for your contribution savings</h2>
          <div className="grid sm:grid-cols-2 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 p-6">
                <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5 text-green-700 dark:text-night-100" />
                </div>
                <h3 className="text-green-900 dark:text-white font-bold text-base mb-1.5">{f.title}</h3>
                <p className="text-green-500 dark:text-night-300 text-sm">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust strip */}
        <section className="max-w-3xl mx-auto px-6 pb-20">
          <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 p-6">
            <ul className="space-y-3">
              {[
                'Every contribution recorded the moment your officer marks your card',
                'Withdraw to your bank account whenever you need to',
                'A full history of every contribution and withdrawal, always available',
              ].map(item => (
                <li key={item} className="flex items-start gap-2.5 text-green-700 dark:text-night-100 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-copper-400 flex-shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <footer className="max-w-5xl mx-auto px-6 py-8 text-center text-green-400 dark:text-night-400 text-xs">
          © {new Date().getFullYear()} MonieKing. Contribution savings, reimagined.
        </footer>
      </div>
    </>
  )
}
