import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'
import { queryClient } from '@/lib/queryClient'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              fontFamily: '"Plus Jakarta Sans", sans-serif',
              fontSize: '14px',
              borderRadius: '10px',
              background: '#052E16',
              color: '#ECFDF5',
            },
            success: { iconTheme: { primary: '#F59E0B', secondary: '#052E16' } },
            error:   { iconTheme: { primary: '#EF4444', secondary: '#FEF2F2' } },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
