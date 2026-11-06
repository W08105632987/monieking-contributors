# Alerts, email and SMS: setup, verification and runbook

This is the step-by-step procedure to make MonieKing tell you the moment something is wrong, through channels that do not
depend on the thing that broke. Do the parts in order. Every part ends with a check you can run.

## 0. How it fits together

| Piece | What it does | Where it lives |
|---|---|---|
| Monitor | Runs every 3 minutes (Celery beat) and runs ~20 checks | `health_service.py`, `monitor_checks.py` |
| Event signals | Instant alerts for fraud / abuse events (bad webhook signature, account lockouts, manual money moves, blocked requests) | `security_signals.py` |
| Alert service | Records each incident once, counts repeats, emails every operator, texts for critical, says when it recovered | `alert_service.py` |
| Email | Resend (HTTPS) and/or SMTP, retried, with a proper HTML message | `email_sender.py` |
| SMS | Termii | `termii.py` |
| External watchdog | Emails you when the monitor itself STOPS (the "Railway is down" alarm) | Healthchecks.io / Better Stack |
| Console | Director > More > System alerts: history, acknowledge, resolve, test button | `AlertsPage.tsx` |

**The rule behind the design:** a server cannot reliably report its own death. So there are two layers: the app reports
problems it can see (Monnify rejecting calls, empty wallet, slow database, error storms, fraud patterns), and an outside
service reports when the app goes silent.

## 1. Email, the way professional systems do it

### 1.1 Choose how mail leaves the server
* **Recommended: Resend** (or any HTTPS email API). It sends over HTTPS, so it works even where the host blocks SMTP ports
  (Railway restricts outbound SMTP on some plans: check your plan), and it gives you the exact DNS records to prove the mail is yours.
* **Alternative: any SMTP relay** (Brevo, Postmark, Amazon SES, Zoho). Use port 587 with STARTTLS, or 465 for implicit TLS.
* Set **both** if you can: each is the automatic fallback for the other.
* Never use a personal Gmail password as the relay for a business system.

### 1.2 Prove the domain is yours (this is what keeps alerts out of spam)
1. In your email provider, add the domain you send from (for example `yourdomain.com`, or a sub-domain like `alerts.yourdomain.com`).
2. At your DNS host add exactly what the provider shows:
   * **SPF**: a TXT record such as `v=spf1 include:<provider> ~all`. Only ONE SPF record per domain: merge, do not duplicate.
   * **DKIM**: the CNAME/TXT record(s) the provider shows (note the "selector" name).
   * **DMARC**: TXT at `_dmarc.yourdomain.com`: `v=DMARC1; p=none; rua=mailto:ops@yourdomain.com`.
     After two clean weeks, change `p=none` to `p=quarantine`.
3. Wait for the provider to show the domain as **Verified**.
4. `SMTP_FROM_EMAIL` must be an address on that verified domain, for example `MonieKing Alerts <alerts@yourdomain.com>`.

### 1.3 Environment variables
Set these on **every Railway service that runs our code: the web API AND the Celery worker AND Celery beat** (each service has its own variables).

```
ALERT_EMAIL_TO=you@gmail.com,cto@yourcompany.com    # two or more, on different email providers
ALERT_PHONE_TO=2348012345678                         # critical alerts are texted here
RESEND_API_KEY=re_...                                # and/or the SMTP_* block below
SMTP_HOST=  SMTP_PORT=587  SMTP_USERNAME=  SMTP_PASSWORD=  SMTP_USE_TLS=true
SMTP_FROM_EMAIL=MonieKing Alerts <alerts@yourdomain.com>
SMTP_REPLY_TO=ops@yourdomain.com                     # a mailbox a human reads
```
Every director who has a verified email on their account also receives alerts automatically.

### 1.4 Verify, with proof
1. Run on the server: `python -m scripts.test_messaging --email you@gmail.com --dkim-selector <selector>`
   It shows the transport, recipients, SPF / DMARC / DKIM status and the exact provider response.
2. In the app: **More > System alerts > Send test email**. The page also shows "Last email: worked <time>" or the exact failure.
3. In Gmail open the test email > **Show original**. You want `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
4. Send one to https://www.mail-tester.com and aim for 9/10 or better.
5. In Gmail create a filter: *From alerts@yourdomain.com > Never send to Spam*, so an alert is never hidden.
6. Check the provider dashboard now and then for bounces and spam complaints, and remove dead addresses.

## 2. SMS (Termii)

1. Complete Termii account verification and fund the wallet.
2. **Register and get your Sender ID approved.** Nigerian networks block or rewrite unregistered sender IDs. Set `TERMII_SENDER_ID` to the approved name.
3. **Pick the route.** `TERMII_CHANNEL=generic` (default) does not deliver to numbers on Do-Not-Disturb. For OTPs and alerts that
   must always arrive, enable the DND route for your sender ID in the Termii dashboard, then set `TERMII_CHANNEL=dnd`.
4. Set `TERMII_API_KEY`, `ALERT_PHONE_TO` (format `2348012345678`, no plus sign), and `TERMII_MIN_BALANCE_NAIRA` (the app warns you below it).
5. Verify: `python -m scripts.test_messaging --sms 2348012345678`, then confirm the text ARRIVED. Repeat on MTN, Airtel, Glo and 9mobile numbers.
6. In the Termii dashboard open the delivery reports and confirm status **Delivered**, not just "Sent".
7. Turn on low-balance notifications / auto-top-up in Termii. The app also watches the balance and alerts you (check `sms`).

## 3. "Railway is down": the external watchdog

The app cannot tell you it is dead, so use outside services. Both have free plans (check current limits).

**A. Dead-man's switch (heartbeat), the key one**
1. Create a free check at Healthchecks.io (or a Heartbeat monitor at Better Stack). Period **5 minutes**, grace **10 minutes**.
2. Add its alert integrations: your email, plus SMS/phone call or a Telegram/WhatsApp integration if available.
3. Copy its ping URL into `ALERT_HEARTBEAT_URL` **on the Celery worker/beat service**. The monitor pings it after every run.
4. If the worker, Railway, the Redis queue or the database dies, the pings stop and **they** email you within about 15 minutes.

**B. Uptime monitor on the public site**
1. In UptimeRobot / Better Stack add an HTTP(S) monitor for `https://<your-api-domain>/health/ready` (expects HTTP 200; it checks the
   database and Redis for real, unlike `/health`), every 1 to 5 minutes. Add a second one for the app's front page.
2. Alert contacts: email and SMS or phone call.

**C. Railway itself**
1. For the API service set the **healthcheck path** to `/health/ready` and the restart policy to restart on failure.
2. Project Settings > Notifications: enable alerts for failed deploys and crashes (email, and a Slack/Discord/webhook if you use one).
3. Set resource and usage alerts so you hear about memory or spend problems early.

**D. Exceptions with stack traces**: set `SENTRY_DSN` (already supported) and add your email to Sentry's issue alerts.

## 4. What the app now watches by itself

| Check | Goes wrong when | Alert |
|---|---|---|
| `monnify_api` | Login rejected, the bills API rejects calls (the real error text is included), or the Monnify wallet is low/empty | critical / warning |
| `monnify_status` | Monnify's own status page shows an incident or maintenance | warning / critical |
| `bills` | A biller's success rate falls below the threshold, almost every purchase fails, or purchases sit pending over 15 min | warning / critical |
| `database`, `db_load` | Slow or unreachable database, connections near the limit, queries over 60 s, lock waits | warning / critical |
| `redis` | Redis unreachable | critical |
| `resources` | Memory, CPU load or disk near the limit on the monitor's machine | warning / critical |
| `error_rate` | Error log lines spike (default 20 per 5 min = warning, 100 = critical) | warning / critical |
| `transactions`, `integrity` | Wallet/history mismatch, negative balances, completed rows missing times, duplicate provider references | critical |
| `fraud` | One bank account on 3+ users, 4+ withdrawals in an hour, 10+ bill purchases in 10 minutes | warning |
| `sms`, `termii` | SMS credit low/empty, last SMS failed, Termii unreachable | warning / critical |
| `alerting` | The alert system itself cannot reach anyone (no transport, no recipients, last email failed) | shown on the dashboard |
| Instant events | Webhook with a bad signature (critical), account lockouts, a burst of blocked requests, **every manual debit and every manual credit at or above the limit** | per event |

Alerts are de-duplicated: the same problem is ONE incident with a counter, re-mentioned only every 30 minutes (critical) or 3 hours
(warning) while it lasts, and you get a "recovered" email when it clears. Tune the thresholds with the env vars in `.env.example`.

## 5. Prove the whole chain works (do this once, then monthly)

1. **Console**: More > System alerts > *Test email + SMS*. Expect an email and a text within a minute.
2. **Fraud path**: send a webhook with a bad signature to your staging API:
   `curl -X POST https://<staging-api>/api/v1/webhooks/monnify/payment -H "monnify-signature: bad" -d '{}'` and expect a critical alert.
3. **Watchdog**: stop the Celery worker on staging for 15 minutes and confirm the Healthchecks.io email arrives. Start it again.
4. **Uptime**: temporarily point the UptimeRobot monitor at a wrong path and confirm it alerts you. Restore it.
5. **Recovery**: confirm you also receive the "recovered" messages.

## 6. When an alert arrives: quick triage

| You see | First thing to do |
|---|---|
| `monnify_api` down, "login FAILED" | Check Monnify keys / base URL in Railway variables; check Monnify dashboard for API key status |
| `monnify_api` down, bills rejecting | Read the message: wallet empty (fund it), service not activated or IP not allowed (contact Monnify), endpoint deprecated (see their change log) |
| `monnify_status` incident | Nothing to fix on our side: customers see a banner; failed vends refund automatically |
| `bills` one biller poor | The network behind that biller is struggling; customers are warned before paying |
| `db_load` / `database` | Check Supabase dashboard (connections, slow queries); look for a stuck job |
| `error_rate` | Open the logs and filter on ERROR; the alert lists the most common messages |
| `integrity` | Do not touch data blindly: export the offending rows and review them first |
| `fraud` / manual money | Confirm with the director or user concerned; freeze the account if it was not them |
| Heartbeat email from Healthchecks.io | The monitor is silent: check Railway deployments and the Celery worker logs |

To diagnose billers directly: `python -m scripts.diagnose_monnify_bills`.
