import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: ['.trycloudflare.com', 'monieking.webodemos.com'],
    // Without this, Vite's HMR client guesses the websocket host/port from
    // window.location, which is wrong behind the Cloudflare Tunnel (it's
    // terminating TLS on 443 and forwarding to this dev server's plain
    // :3000 — the client needs to be told that explicitly). When the HMR
    // socket can't connect it silently falls back to full-page reloads,
    // and if the tunnel also drops mid-session, the browser can end up
    // holding both a stale and a freshly re-optimized dep chunk at once —
    // that's what produces "two copies of React" / null useContext errors.
    // Only overridden when running behind the tunnel — set
    // VITE_TUNNEL_HOST=monieking.webodemos.com in that terminal session
    // (or add it to apps/web/.env). Leaving it unset keeps plain
    // localhost dev working exactly as before; hardcoding the tunnel
    // host here instead would break localhost dev, since Vite can't
    // tell at startup which one the browser will actually use.
    hmr: process.env.VITE_TUNNEL_HOST
      ? { host: process.env.VITE_TUNNEL_HOST, protocol: 'wss', clientPort: 443 }
      : true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/webhooks': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
