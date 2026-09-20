MonieKing logo — drop-in instructions
======================================

1. App mark (splash / login / onboarding carousel)
   Save the final logo as:
     apps/web/public/brand/logo.png
   Square, transparent background, at least 512x512px.
   AppLogo.tsx (src/components/ui/AppLogo.tsx) picks this up
   automatically — no code changes needed once it's here.

2. PWA install icons (home-screen icon, splash on install)
   These are separate static files referenced directly in
   manifest.webmanifest and must be regenerated at the exact
   sizes below once the final logo is ready:
     apps/web/public/icons/icon-192.png            192x192, flat
     apps/web/public/icons/icon-512.png             512x512, flat
     apps/web/public/icons/icon-maskable-192.png    192x192, logo
                                                     kept inside the
                                                     center ~80% safe
                                                     zone (Android
                                                     masks the outer
                                                     ring into a
                                                     circle/squircle)
     apps/web/public/icons/icon-maskable-512.png    512x512, same
                                                     safe-zone rule
     apps/web/public/apple-touch-icon.png           180x180, flat,
                                                     opaque background
                                                     (iOS ignores
                                                     transparency)
   Any online "PWA icon generator" (e.g. maskable.app for the
   maskable pair) can produce all five from one source image.
