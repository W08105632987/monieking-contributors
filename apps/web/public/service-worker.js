// MonieKing service worker — enables "Add to Home Screen" / desktop
// install prompts. Deliberately conservative caching: only static build
// assets get cached, and only GET requests. Every API call (anything
// under /api/) always goes straight to the network — financial data
// must never be served stale or offline.

const CACHE_NAME = 'monieking-shell-v1'
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

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => cached)
      // Stale-while-revalidate: serve cached instantly if we have it,
      // refresh the cache in the background either way
      return cached || networkFetch
    })
  )
})
