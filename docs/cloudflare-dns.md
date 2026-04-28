# Cloudflare DNS

Email DNS records must be `DNS only`. Do not proxy email-related records through Cloudflare.

## Recommended Migration Layout

Keep the old Mailgun subdomain during the transition:

```text
mg.example.com
```

Use SES on the root sending domain and a separate MAIL FROM subdomain:

```text
example.com
bounce.ses.example.com
```

This lets Mailgun and SES coexist while you test.

## SES Identity Records

When you create a domain identity in SES with Easy DKIM, SES gives you three CNAME records.

Add them in Cloudflare exactly as SES shows them:

```text
TYPE   NAME                         TARGET
CNAME  token1._domainkey.example    token1.dkim.amazonses.com
CNAME  token2._domainkey.example    token2.dkim.amazonses.com
CNAME  token3._domainkey.example    token3.dkim.amazonses.com
```

Cloudflare may display the names with or without the root domain. That is normal. The final record must resolve for:

```text
token._domainkey.example.com
```

## Custom MAIL FROM Records

If your custom MAIL FROM is:

```text
bounce.ses.example.com
```

SES provides records similar to:

```text
TYPE  NAME        VALUE
MX    bounce.ses  feedback-smtp.REGION.amazonses.com
TXT   bounce.ses  v=spf1 include:amazonses.com -all
```

Use priority `10` for the MX unless SES shows a different value.

## Root SPF

If your root domain already has SPF, do not create a second root SPF record. A domain should have one SPF TXT record.

If SES sends with `MAIL FROM` aligned through `bounce.ses.example.com`, the root SPF is less critical for SES DMARC alignment because SPF passes on the MAIL FROM domain and DKIM passes on the From domain. Still, keep your root SPF correct for other senders.

Example if Google Workspace and SES both send as the root domain:

```text
v=spf1 include:_spf.google.com include:amazonses.com ~all
```

If only SES sends:

```text
v=spf1 include:amazonses.com ~all
```

## DMARC

Start with monitoring:

```text
TYPE  NAME    VALUE
TXT   _dmarc  v=DMARC1; p=none; rua=mailto:dmarc@example.com; adkim=s; aspf=s
```

After you have stable sending and reports look good, move gradually to:

```text
v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; adkim=s; aspf=s
```

Then, only when you are confident:

```text
v=DMARC1; p=reject; rua=mailto:dmarc@example.com; adkim=s; aspf=s
```

## When To Remove Mailgun DNS

Remove Mailgun DNS only after:

- SES production access is enabled.
- DKIM, SPF, and DMARC pass.
- Ghost transactional email works.
- Ghost newsletters work through this proxy.
- Bounces, complaints, opens, and unsubscribes are visible.
- You have kept Mailgun as fallback for 7 to 15 days.

Then remove records under `mg.example.com` that were only used by Mailgun.
