# Play launch checklist (organisation account)

1. Register an ORGANISATION Play Console account: registered business, D-U-N-S number, website, phone/email verification.
   (Ask Google whether the 12-testers/14-days closed test applies to your account - organisation accounts are normally exempt.)
2. Deploy this update (Vercel). Then check these open in a normal browser:
   - https://app.monieking.com/legal/privacy  and  /legal/delete-account
   - https://app.monieking.com/.well-known/assetlinks.json  (must return JSON, not the app page)
3. Build the wrapper (on a computer with Node + Java): `npm i -g @bubblewrap/cli`, then in /play run `bubblewrap init --manifest=https://app.monieking.com/manifest.webmanifest`
   (or reuse twa-manifest.json) and `bubblewrap build`. Keep android.keystore + passwords SAFE (back them up).
   Upload the .aab to Play Console, turn on Play App Signing.
4. Copy the SHA-256 certificate fingerprint from Play Console (Setup > App signing) into apps/web/public/.well-known/assetlinks.json
   together with the package name, redeploy. Without this the app shows a browser bar.
5. Fill: Data safety form, Content rating, Target audience (18+), Financial features declaration (wallet/bill payments, no loans),
   App access (give a demo login), Ads (none), Privacy policy URL, Account deletion URL.
6. Closed/internal test first, then Production. Review takes about 3-7 days.
7. After first install, confirm inside the app: no NIN / BVN / NIMC services appear anywhere (home, Services, search, history links).
