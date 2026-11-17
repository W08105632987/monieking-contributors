# VTU plans, airtime backup and Airtime to Cash (GYKDATASUB): setup, go-live gate and runbook

## 1. What was built

| Piece | What it does |
|---|---|
| **VTU plans** | GYKDATASUB's cheap data bundles appear as the **VTU plans** tab (opens first). Monnify's plans are the **Standard plans** tab. Monnify plans that have "VTU" in their name are now Standard. |
| **Pricing** | VTU price = supplier cost + a markup (default **6%**, rounded up to a whole naira). The default is editable, and every single plan can be priced by hand in *Prices & profit*. A sync never overwrites your prices; only the supplier's cost follows. A plan is never sold below cost. |
| **Airtime backup + manual switch** | Directors choose the airtime provider (Monnify by default, or VTU) and whether to switch automatically. If the first supplier definitely did nothing (down, rejected, empty wallet), airtime moves to the other. |
| **Data tabs** | If one supplier is down, customers automatically see the other tab. Data does not switch plan-for-plan (they are different products). |
| **Accounting** | Bills now split by supplier: "Data bills (Standard)", "Data bills (VTU)", and a VTU airtime row when VTU served airtime. A new **Airtime to Cash** row shows our margin. |
| **Airtime to Cash** | Customers sell airtime from their own line for wallet cash. **Off by default.** Web only (never in the Play app). |
| **Monitoring** | New `vtu_api` health check (key accepted, wallet balance, low-wallet alert) feeding the alert system. |

## 2. Read this first: what is and is not known about GYKDATASUB

I could read their published Developer Hub and the code of their own app, but I **cannot test their live API from here**. Facts that shape the design:

* They have **no idempotency key, no webhook, and no "look up this purchase" endpoint**. If a reply is lost we cannot ask "did it happen?" with one call.
  So: an unclear result is **held (pending)**, matched against their wallet history (phone + time), and sent to a human if still unclear after an hour.
  Another supplier is tried **only** when the first definitely did nothing. An unclear outcome is never retried elsewhere, so nobody is charged twice.
* Their **documentation and their own mobile app disagree** (`/api/topup/` + `network` vs `/api/airtime/` + `network_id`; `plan`+`mobile_number` vs `plan_id`+`phone`). The data call sends both spellings and the paths are settings.
  `scripts/diagnose_gyk.py` proves what really works with one ₦100 purchase. **Do not skip it.**
* It behaves like a **reseller wallet app with an API added**, not a purpose-built partner API. Expect more manual care than with Monnify. Check their support responsiveness before relying on it.

## 3. Go-live gate (do these IN ORDER; stop if any step fails)

1. **Rotate your API key.** The token was visible in a screenshot. In their Developer Hub generate a new one. Never paste a key into chat, email or screenshots again.
2. Run migrations **071** then **072** in Supabase.
3. On Railway set the variables below on the API service, the Celery worker **and** Celery beat.
   ```
   GYK_API_KEY=...        GYK_BASE_URL=https://gykdatasub.com
   GYK_AIRTIME_PATH=/api/topup/   GYK_DATA_PATH=/api/data/
   GYK_MIN_WALLET_NAIRA=10000     GYK_UNMATCHED_FAIL_MINUTES=90
   ```
   If GYKDATASUB lets you restrict an API key by IP, you will need a fixed outbound IP; otherwise leave it unrestricted.
4. Fund your GYKDATASUB wallet with a small amount (for example ₦2,000).
5. On the server run `python -m scripts.diagnose_gyk`. All four checks must pass (key accepted, plan list, fees, wallet history readable).
6. Run one real test to **your own** number: `python -m scripts.diagnose_gyk --buy-airtime 0801XXXXXXX --amount 100 --yes`. **Check that the airtime really arrived.**
   If it fails with a path or field error, set `GYK_AIRTIME_PATH=/api/airtime/` (and if needed `GYK_TRANSACTION_PIN`) and repeat. Send the output to the developer.
7. In **Airtime, Data & Bills** press **Sync VTU plans now**. Open *Prices & profit > Data > VTU* and sanity-check costs, prices and profits against GYKDATASUB's own price list.
8. Buy two or three small VTU data plans yourself (different networks). Confirm delivery.
9. Only then leave **VTU data plans** switched on for customers. (The tab is hidden automatically until the supplier is set up and has plans.)
10. Optional, later: set **Airtime provider** to VTU or leave Monnify first with automatic backup on.
11. **Airtime to Cash last**, and only after you have read section 6.

## 4. What the director controls (Airtime, Data & Bills)

* **VTU supplier card**: connected / down, wallet balance (low-wallet warning), plan count, success rate, *Sync VTU plans now*, and the default markup with *Apply to all VTU plans*.
* **Airtime provider**: Monnify (default) or VTU. **Switch automatically when one is down**: on by default.
* **Data tab that opens first**: VTU plans (default) or Standard.
* **Prices & profit**: filter by supplier; supplier cost shown for VTU plans.
* Nightly plan sync at 02:00 Lagos time. Plans whose cost rose above the price you set trigger an alert and are not sold until you raise them.

## 5. How a supplier is judged "down"

The monitor (every 3 minutes) checks the wallet and the key. Three definite provider-side failures in five minutes also mark a supplier down for five minutes. A supplier that is down is skipped for airtime and its data tab is hidden (when the other tab can take over). It recovers automatically.

## 6. Airtime to Cash: understand the risk before turning it on

How it works: the customer enters their number, receives a one-time code on that line, enters the code, then enters the line's **SIM transfer PIN** and their MonieKing PIN. GYKDATASUB takes the airtime and credits **our** wallet; we credit the customer's wallet with that amount minus your margin.

* **The SIM transfer PIN passes through our server to the supplier.** It is never stored or logged, and error reporting is scrubbed of it, but it is sensitive. Tell customers plainly, as the app does.
* **Fraud risk is real**: airtime from stolen or borrowed lines, and airtime that a network later reverses after we have paid the customer. Defaults: verified accounts only, 7-day-old accounts, ₦5,000 per request, ₦10,000 per day, OTP proof of line ownership, and a director kill switch. Start with lower limits.
* The customer is credited **only after the supplier confirms**. If the reply is unclear the request goes to **Needs your decision** (Bills Control) and nobody is paid until a director approves after checking the supplier's own records.
* Check the **legal and network-rule position** for airtime-to-cash in your situation (network terms, your CBN/licensing posture, consumer terms) before enabling it. I have not verified this.
* It is **web only**. The Play build hides it and the server refuses it for the Play client.
* The supplier's credit rate is read live from their fees endpoint. **Compare one quote to their own app screen before enabling** (the quote shows what the customer receives; our margin is the difference).

## 7. Runbook

| Situation | Action |
|---|---|
| VTU purchases failing | Check *VTU supplier card* and System health `vtu_api`. Wallet low? Fund it. Key rejected? Rotate and update the variable. |
| A VTU purchase stays "processing" | It is matched against their history automatically. After an hour you get an alert. Check their dashboard and, if delivered, nothing to do; if not, the customer is refunded after `GYK_UNMATCHED_FAIL_MINUTES`. |
| Plan cost alert ("sales blocked") | Raise the customer price of those plans or press *Apply to all VTU plans*. |
| Airtime to Cash "needs your decision" | Look the request up in GYKDATASUB's history. Approve only if they took the airtime. |
| Want to go back to Monnify only | Switch **Airtime provider** to Monnify, turn off **VTU data plans**. No customer data is lost. |
