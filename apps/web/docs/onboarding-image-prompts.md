# MonieKing Onboarding Illustrations — AI Image Generation Brief

Use this document as-is with Gemini, ChatGPT (DALL-E), or any other
image model. Copy one screen's full prompt block at a time — generate
each screen separately, not all four in one image.

Save the results as:
`apps/web/public/onboarding/screen-1.png` … `screen-4.png`
(exact filenames, in that folder — see the README already sitting in
that folder for the drop-in mechanics.)

---

## Brand color schema (use for every screen)

| Role | Hex | Where it's used |
|---|---|---|
| Deep Forest Green (primary) | `#052E16` | Dominant background tone, dark shapes, badge fills |
| Mid Green | `#065F46` | Secondary shading, gradients, mid-tone shapes |
| Emerald Accent | `#059669` | Small highlight details, secondary accents |
| Soft Mint Surface | `#D1FAE5` | Light background fields, soft shapes behind figures |
| White | `#FFFFFF` | Cards, negative space, highlights, text-safe zones |
| Copper / Amber (accent only) | `#F59E0B` | ONE small accent per scene — a coin, a highlight, a badge detail. Never a dominant color. |

**Do not use purple, blue, pink, or red anywhere.** This is a green +
white + copper palette only — no exceptions, no "close enough" hues.

---

## Universal style instructions (paste into every prompt)

> Flat vector illustration style, modern fintech app onboarding
> screen, clean and minimal, soft rounded shapes, no harsh outlines,
> gentle drop shadows only, generous white/negative space, no text or
> lettering anywhere in the image, no logos or brand names rendered
> in the artwork, portrait orientation, centered composition with
> breathing room on all sides, color palette strictly limited to deep
> forest green (#052E16), mid green (#065F46), soft mint (#D1FAE5),
> white (#FFFFFF), and a single small copper/amber (#F59E0B) accent
> detail — no other colors. Nigerian/West African characters where
> people are shown, contemporary casual clothing, warm and trustworthy
> mood, not corporate-cold.

---

## Screen 1 — Welcome to MonieKing

**On-screen text (added later in code, NOT rendered in the image
itself):**
> Welcome to MonieKing
> Nigeria's digital contribution savings platform — a modern ajo and
> esusu, right on your phone.

**Image prompt:**
> A friendly Nigerian man and woman standing together, both looking
> at a smartphone the woman is holding, smiling. The phone screen
> glows softly in copper/amber. Behind them, a large soft mint-green
> circle. [use the universal style instructions above]

---

## Screen 2 — A Zone Officer You Know

**On-screen text:**
> A Zone Officer You Know
> Save with a food card or a regular contribution card, collected in
> person by a trusted zone officer — recorded instantly, never a lost
> paper card.

**Image prompt:**
> A friendly Nigerian zone officer in a green polo shirt handing a
> small contribution card to a smiling customer at their doorstep,
> both standing outdoors near a modest house. A small copper/amber
> checkmark or badge icon floats near the card being exchanged. [use
> the universal style instructions above]

---

## Screen 3 — Your Wallet, Always With You

**On-screen text:**
> Your Wallet, Always With You
> Fund your wallet, withdraw with ease, and pay airtime, data,
> electricity and cable bills — all from one place.

**Image prompt:**
> A stylized digital wallet card floating above a smartphone, with
> small icons orbiting around it representing airtime, electricity,
> and bill payments — each icon a simple flat green shape with one
> copper/amber accent. A single hand reaching up toward the phone
> from below. [use the universal style instructions above]

---

## Screen 4 — Track Every Contribution

**On-screen text:**
> Track Every Contribution
> Watch your savings grow, review your full transaction history, and
> see every card and withdrawal in one clear timeline.

**Image prompt:**
> A smiling Nigerian woman looking at a rising bar chart / growth
> graph displayed on a smartphone or tablet she's holding, with a
> small potted plant or an upward arrow beside the chart symbolizing
> growth. One copper/amber accent on the tallest bar or the arrow
> tip. [use the universal style instructions above]

---

## After generating

1. Download each image.
2. Rename exactly: `screen-1.png`, `screen-2.png`, `screen-3.png`,
   `screen-4.png`.
3. Drop them into `apps/web/public/onboarding/`.
4. No code changes needed — `OnboardingCarousel.tsx` already points
   at those exact filenames.
