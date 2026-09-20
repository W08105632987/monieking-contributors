MonieKing onboarding — image status
=====================================

screen-1.jpg, screen-2.jpg, screen-3.jpg, screen-4.jpg are already in
this folder — the real photos supplied via the Lovable-built project,
carried over as-is. OnboardingSlides.tsx (the shared component behind
both the pre-login carousel and the About MonieKing screen) points at
these exact filenames already — nothing else to wire up.

FLAG — screen-2.jpg: the man on the right is wearing a T-shirt with a
visible third-party brand logo ("branch", green leaf mark) printed on
it. That's another company's actual trademark, sitting in MonieKing's
own onboarding flow. Worth swapping for a version without a competing
brand visible before this ships to production — either crop tighter,
pick a different frame from the same shoot if one exists, or swap the
photo.

To replace any of the four: drop a new file in with the same filename
(same aspect ratio recommended — roughly portrait 9:16) and it's
picked up automatically, no code changes needed.
