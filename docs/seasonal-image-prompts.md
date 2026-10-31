# Seasonal image prompts

Optional artwork for the seasonal themes. The app works without these files: if one is missing it is silently skipped and the built-in CSS/SVG decoration is used. Drop a file at the exact path and it appears (no code change).

Common rules for every image:
- Format: WebP (lossy quality 80-85 with transparency, or lossless if the edges look rough). Keep each file under 150 KB.
- Transparent background (alpha). If the generator cannot output transparency, generate on a flat pure-white or pure-green background and remove it afterwards (e.g. remove.bg, Photoshop, Photopea) before exporting.
- No text, no logos, no watermarks, no people. The app overlays its own UI and greeting text.
- Brand colours: deep green (#14532d) and copper/gold (#b45309). Keep the middle area clear and uncluttered.
- Images are purely decorative and never receive taps.

## 1. Christmas header
- Path: `apps/web/public/seasonal/christmas-header.webp`
- Size: 1600 x 240 px (20:3 wide strip). Shown across the very top of every screen, about 96 px high on phones, cropped from the bottom.
- Prompt:
  > Wide horizontal Christmas border strip, 1600x240, transparent background. Decoration hangs from the very top edge only: a garland of pine branches with red berries, golden baubles, small gift-wrapped ornaments and warm twinkling string lights, soft snow dusted on the branches. Flat, clean vector-style illustration with gentle shading, rich deep green and gold with touches of red. The bottom 55% of the strip is fully transparent and empty. No text, no characters.

## 2. Christmas wallet card overlay
- Path: `apps/web/public/seasonal/christmas-wallet.webp`
- Size: 1200 x 720 px (5:3). Stretched over the wallet balance card (card is roughly 340 x 200; it is cover-fitted, so keep important art within 8% of the edges).
- Prompt:
  > Christmas corner decoration overlay for a credit-card style panel, 1200x720, transparent background. Pine branches with red berries, golden baubles and a few snowflakes tucked into the top-right and bottom-left corners only, soft glow, a sprinkle of tiny gold stars. The entire centre (about 65% of the area) must be fully transparent and empty so text stays readable. Flat vector illustration, deep green, gold, and red accents. No text, no characters.

## 3. New Year header
- Path: `apps/web/public/seasonal/newyear-header.webp`
- Size: 1600 x 240 px (20:3 wide strip). Shown across the top of every screen from 1 January.
- Prompt:
  > Wide horizontal New Year celebration border strip, 1600x240, transparent background. Along the top edge: bursting golden and emerald fireworks, hanging gold and silver streamers, glittering stars and small champagne-gold confetti. Elegant, festive, clean vector style with soft glow. The bottom 55% of the strip is fully transparent and empty. No numbers, no text, no characters.

## 4. Easter header
- Path: `apps/web/public/seasonal/easter-header.webp`
- Size: 1600 x 240 px (20:3 wide strip). Shown across the top of every screen while Easter is on.
- Prompt:
  > Wide horizontal Easter border strip, 1600x240, transparent background. Along the top edge: pastel bunting flags, hand-painted Easter eggs in pink, sky blue, soft yellow and mint, tulips and daisies with green leaves, a tiny chick peeking in. Soft, cheerful, clean vector style. The bottom 55% of the strip is fully transparent and empty. No text, no people.

## Checking it worked
1. Put the file at the exact path above (the `public/seasonal/` folder already exists).
2. Switch the matching theme on in Director > Seasonal themes.
3. Hard-refresh the app. Missing or broken files simply do not show.
