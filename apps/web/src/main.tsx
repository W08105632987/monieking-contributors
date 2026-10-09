import './lib/pwaInstall'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'
import { queryClient } from '@/lib/queryClient'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { FeedbackModalHost } from '@/components/ui/FeedbackModalHost'
import { initSessionLifecycle } from '@/lib/sessionLifecycle'

// Before React renders anything: the resume handler, privacy shield and
// durable-logout retry must be live from the first moment, independent of
// any component mounting (or mounting late). See sessionLifecycle.ts.
initSessionLifecycle()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <FeedbackModalHost />
          <Toaster
            position="top-center"
            containerStyle={{
              top: 'max(1rem, env(safe-area-inset-top))',
              zIndex: 9999,
              transform: 'translateZ(0)',
              WebkitTransform: 'translateZ(0)',
            }}
            toastOptions={{
              style: {
                fontFamily: '"Plus Jakarta Sans", sans-serif',
                fontSize: '14px',
                borderRadius: '12px',
                background: '#052E16',
                color: '#ECFDF5',
              },
              success: { iconTheme: { primary: '#F59E0B', secondary: '#052E16' } },
              error:   { iconTheme: { primary: '#EF4444', secondary: '#FEF2F2' } },
            }}
          />
        </BrowserRouter>
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
