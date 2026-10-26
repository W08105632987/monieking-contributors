import './lib/pwaInstall'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { queryClient } from '@/lib/queryClient'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { FeedbackModalHost } from '@/components/ui/FeedbackModalHost'
import { CelebrationHost } from '@/components/ui/CelebrationHost'
import { SeasonalLayer } from '@/components/ui/SeasonalLayer'
import { DialogHost } from '@/components/ui/DialogHost'
import { PinHost } from '@/components/ui/PinHost'
import { NoticeHost } from '@/components/ui/NoticeHost'
import { KycGateHost } from '@/components/ui/KycGateHost'
import { DownloadHost } from '@/components/ui/DownloadHost'
import { initSessionLifecycle } from '@/lib/sessionLifecycle'

// Before React renders anything: the resume handler, privacy shield and
// durable-logout retry must be live from the first moment, independent of
// any component mounting (or mounting late). See sessionLifecycle.ts.
initSessionLifecycle()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <App />
          <FeedbackModalHost />
          <DialogHost />
          <PinHost />
          <DownloadHost />
          <CelebrationHost />
          <SeasonalLayer />
          <NoticeHost />
          <KycGateHost />
        </BrowserRouter>
        </MotionConfig>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)

// Register the service worker for PWA installability. Registered after
// load so it never competes with the initial page render for bandwidth.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // Non-fatal — the app works perfectly fine without it, this just
      // means no install prompt / offline shell caching.
    })
  })
}
