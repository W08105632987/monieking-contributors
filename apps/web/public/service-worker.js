// MonieKing service worker — enables "Add to Home Screen" / desktop
// install prompts. Deliberately conservative caching: only static build
// assets get cached, and only GET requests. Every API call (anything
// under /api/) always goes straight to the network — financial data
// must never be served stale or offline.

const CACHE_NAME = 'monieking-shell-v4'
const APP_SHELL = ['/', '/manifest.webmanifest', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Never cache API calls — always fresh from the network
  if (url.pathname.startsWith('/api/')) return

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return

  // Navigation requests (the HTML document itself) — ALWAYS check the
  // network first, so a new deploy is never blocked by an old cached
  // index.html pointing at old, already-gone JS bundle filenames.
  // Every branch below is guaranteed to return a real Response object —
  // resolving to undefined here is what previously crashed navigation
  // outright with "Failed to convert value to 'Response'".
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          // Cache the fresh shell for offline fallback — best-effort,
          // never let a caching failure affect the actual response.
          try {
            const cache = await caches.open(CACHE_NAME)
            await cache.put(request, response.clone())
          } catch (_) { /* ignore — caching is a bonus, not a requirement */ }
          return response
        } catch (_) {
          // Network genuinely unreachable — fall back to whatever we
          // have cached, in order of preference.
          const cached = await caches.match(request)
          if (cached) return cached
          const shell = await caches.match('/')
          if (shell) return shell
          // Nothing cached at all (very first load, fully offline) —
          // a real Response is mandatory here, not optional.
          return new Response(
            '<h1>You appear to be offline</h1><p>Please check your connection and try again.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html' } }
          )
        }
      })()
    )
    return
  }

  // Everything else same-origin (hashed JS/CSS build assets) — cache-first
  // is safe here specifically because Vite gives each build's files a new
  // content hash in the filename, so "stale" cached assets under an OLD
  // filename are simply never requested again once index.html updates.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) {
        // Refresh the cache in the background for next time — but never
        // let a failure here affect the response we already have.
        fetch(request)
          .then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
            }
          })
          .catch(() => {})
        return cached
      }
      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(request, response.clone())
        }
        return response
      } catch (_) {
        // Truly nothing available — a real Response is still mandatory.
        return new Response('', { status: 504, statusText: 'Offline and not cached' })
      }
    })()
  )
})
