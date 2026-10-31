# UX / motion audit notes

## Why things stuttered
- Slide-up sheets used springs (overshoot, long settle, main-thread work) layered over full-screen `backdrop-blur` overlays; blurring a full viewport every frame is very expensive on mid/low-end phones.
- Modal had no scroll lock, so the page behind scrolled/rubber-banded while a sheet moved.
- PaymentReceipt mounted its full content (logo spring, token cards, field list) at the same moment it slid in.

## What changed
- `src/lib/motion.ts`: shared presets (`sheetMotion`, `overlayMotion`, `dialogMotion`, `pageMotion`, `pageFade`, `listContainer/listItem`, `willAnimate`). Sheets are a 0.34s tween on cubic-bezier(0.22,1,0.36,1), exit 0.24s ease-in; transform/opacity only.
- Codemod: 33 files with `y: '100%'` sheets now spread `{...sheetMotion}`; their dim layers became `motion.div {...overlayMotion}` (fade) with no blur. All other full-screen (`inset-0`) overlays also lost `backdrop-blur` (53 usages remain, only on small sticky bars/chips). Left untouched on purpose (owned by another agent): `pages/customer/WalletPage.tsx`, `SeasonalLayer`.
- `components/ui/Modal.tsx`: ref-counted scroll lock (`hooks/useScrollLock.ts`), swipe-down-to-dismiss on mobile (offset or velocity), Escape, `role=dialog`/`aria-modal`/`aria-labelledby`, focus trap + focus restore, safe-area bottom padding, `overscroll-contain`, desktop uses a scale/fade dialog centered with auto margins (no Tailwind translate fighting framer's transform).
- `PaymentReceipt`: shows a cheap skeleton while sliding; the field list, token cards and logo animation mount on `onAnimationComplete` (timeout fallback), share/export disabled until ready, scroll lock, dialog semantics, safe-area action bar, `contain: layout paint`.
- `index.css`: tap highlight, `touch-action: manipulation`, `overscroll-behavior`, font smoothing, `.mk-skeleton` transform-only shimmer, global `prefers-reduced-motion` handling.
- `lib/preloadRoutes.ts`: `prefetchRoute` (hover/touch on bottom nav) and `prefetchWhenIdle` (secondary customer pages, skipped on data-saver). `BottomNav` wires pointer/touch prefetch and a tap haptic. `lib/haptics.ts` is guarded and respects reduced motion; `Button` fires a light tap.

## Page-by-page observations
- Customer Wallet: not migrated (still spring + blur sheets at lines ~87/169); migrate to `sheetMotion` + `overlayMotion` once the other change lands.
- Customer Profile / Cards / Transactions / Notifications / Withdrawal / CardDetail: multiple sheets per page, all unmounted/remounted via AnimatePresence; consider `React.lazy` for the heavy ones.
- Officer Wallet / Customers / CardDetail: 3 sheets each, large inline JSX; same advice.
- Worker pages: modal wrappers use `sm:items-center` with the slide-up animation on desktop as well; consider `dialogMotion` for `sm:` and up.
- Director pages: sticky bars (`backdrop-blur` on bottom action bars) kept; cost is small, but replace with solid `bg-white` if scroll jank shows.
- BottomNav blob animates `left/width` with a spring (layout properties); switching it to `x` transform would be a further win.
- Remaining 89-ish spring transitions elsewhere (buttons, cards, lists) were not bulk-changed; prefer `listContainer/listItem` when touching them.
- Not verified at runtime (no network / no browser): run on a real low-end Android device and check the Performance panel for dropped frames while opening sheets.
