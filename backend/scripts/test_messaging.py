"""
Proves, from the machine that runs the API, that email and SMS actually work. Read-only except for the test messages YOU ask for.

    python -m scripts.test_messaging                         # show configuration, check DNS records and SMS credit
    python -m scripts.test_messaging --email you@gmail.com   # also send a real test email and show the exact result
    python -m scripts.test_messaging --sms 2348012345678     # also send a real test SMS
    python -m scripts.test_messaging --dkim-selector resend  # also check this DKIM selector exists for the sending domain
"""
import argparse
import asyncio
import sys
from email.utils import parseaddr

from app.core.config import settings
from app.integrations import email_sender as E
from app.integrations.termii import get_balance, send_sms

PASS, FAIL, INFO = "[ OK ]", "[FAIL]", "[INFO]"


LOOKUP_FAILED = "__lookup_failed__"


def txt(domain: str, kind: str = "TXT") -> list[str]:
    """Records for a name. [] = the name has no such record. [LOOKUP_FAILED] = we could not ask (no dnspython, or no DNS from here)."""
    try:
        import dns.resolver  # type: ignore
        import dns.exception
    except ImportError:
        return [LOOKUP_FAILED]
    try:
        return [r.to_text().strip('"') for r in dns.resolver.resolve(domain, kind)]
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return []
    except dns.exception.DNSException:
        return [LOOKUP_FAILED]


def dns_checks(domain: str, selector: str | None) -> None:
    first = txt(domain)
    if first == [LOOKUP_FAILED]:
        print(f"{INFO} DNS checks skipped (install dnspython with 'pip install dnspython', and run this where DNS works). Check by hand:")
        print(f"       nslookup -type=TXT {domain}            (look for v=spf1)")
        print(f"       nslookup -type=TXT _dmarc.{domain}     (look for v=DMARC1)")
        return
    spf = [t for t in first if t.startswith("v=spf1")]
    print(f"{PASS if spf else FAIL} SPF record on {domain}: {spf[0] if spf else 'MISSING. Your provider gives you the exact value to add.'}")
    dmarc = [t for t in txt(f"_dmarc.{domain}") if t.startswith("v=DMARC1")]
    print(f"{PASS if dmarc else FAIL} DMARC record: {dmarc[0] if dmarc else 'MISSING. Add TXT _dmarc  v=DMARC1; p=none; rua=mailto:you@yourdomain.com'}")
    if selector:
        name = f"{selector}._domainkey.{domain}"
        found = [r for r in (txt(name) or txt(name, "CNAME")) if r != LOOKUP_FAILED]
        print(f"{PASS if found else FAIL} DKIM {name}: {'found' if found else 'MISSING. Add the DKIM record your provider shows for this domain.'}")
    else:
        print(f"{INFO} DKIM not checked (pass --dkim-selector <name>; the selector is shown next to the DKIM record in your email provider).")


async def main(a) -> int:
    bad = 0
    domain = parseaddr(settings.SMTP_FROM_EMAIL)[1].split("@")[-1]
    transports = [n for n, on in (("Resend (HTTPS API)", bool(settings.RESEND_API_KEY)), (f"SMTP {settings.SMTP_HOST}:{settings.SMTP_PORT}", bool(settings.SMTP_HOST))) if on]
    print(f"{PASS if transports else FAIL} Email transport: {', '.join(transports) or 'NONE. Set RESEND_API_KEY or SMTP_HOST.'}")
    bad += not transports
    print(f"{INFO} From: {settings.SMTP_FROM_EMAIL}   Reply-To: {settings.SMTP_REPLY_TO or '(not set)'}")
    rec = [e for e in settings.ALERT_EMAIL_TO.split(",") if e.strip()]
    print(f"{PASS if rec else FAIL} Alert recipients (ALERT_EMAIL_TO): {', '.join(rec) or 'NONE'}")
    bad += not rec
    if len({r.split('@')[-1].lower() for r in rec}) < 2 and rec:
        print(f"{INFO} All recipients are on one email provider. Add one on a different provider so a single outage cannot blind you.")
    if domain:
        dns_checks(domain, a.dkim_selector)

    if a.email:
        message = E._build([a.email], "MonieKing test email", "If you can read this, email delivery works.", "<p><b>If you can read this, email delivery works.</b></p>", True, None)
        results = []
        if settings.RESEND_API_KEY:
            results.append(("Resend", *await E._send_via_resend([a.email], "MonieKing test email", "If you can read this, email delivery works.", None, True, None)))
        if settings.SMTP_HOST:
            results.append(("SMTP", *await E._send_via_smtp(message)))
        for name, ok, why in results:
            print(f"{PASS if ok else FAIL} Test email via {name}: {'accepted by the provider. Now CHECK THE INBOX and the spam folder.' if ok else why}")
            bad += not ok
    else:
        print(f"{INFO} No test email sent (pass --email you@example.com).")

    print(f"{PASS if settings.TERMII_API_KEY else FAIL} Termii API key: {'set' if settings.TERMII_API_KEY else 'MISSING'}; sender ID '{settings.TERMII_SENDER_ID}', channel '{settings.TERMII_CHANNEL}'")
    bad += not settings.TERMII_API_KEY
    bal = await get_balance()
    if bal:
        low = bal["balance"] < settings.TERMII_MIN_BALANCE_NAIRA
        print(f"{FAIL if low else PASS} Termii balance: {bal['currency']} {bal['balance']:,.2f}" + ("  <- LOW, top up" if low else ""))
        bad += low
    elif settings.TERMII_API_KEY:
        print(f"{FAIL} Termii balance could not be read (key rejected, or Termii unreachable from this server)")
        bad += 1
    if a.sms:
        ok = await send_sms(a.sms, "MonieKing test SMS: if you can read this, SMS delivery works.")
        print(f"{PASS if ok else FAIL} Test SMS to {a.sms}: {'accepted by Termii. Confirm it ARRIVED on the phone.' if ok else 'rejected (see the [termii] line in the logs for the reason)'}")
        bad += not ok
    else:
        print(f"{INFO} No test SMS sent (pass --sms 2348012345678).")
    print("\n" + ("Everything checked is working." if not bad else f"{bad} problem(s) above need fixing."))
    return 1 if bad else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--email"); ap.add_argument("--sms"); ap.add_argument("--dkim-selector")
    sys.exit(asyncio.run(main(ap.parse_args())))
