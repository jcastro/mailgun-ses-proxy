# Amazon SES Setup

This proxy requires Amazon SES, SQS, SNS event publishing, and IAM credentials.

Recommended region for European sites:

```text
eu-west-1
```

Use the same region for SES, SNS, and SQS unless you have a strong reason not to.

## 1. Verify The Sending Domain

Open:

```text
Amazon SES > Configuration > Identities > Create identity
```

Choose:

```text
Identity type: Domain
Domain: example.com
DKIM: Easy DKIM enabled
```

After creation, SES shows DKIM DNS records. Add them at your DNS provider. For Cloudflare-specific notes, see [cloudflare-dns.md](cloudflare-dns.md).

Wait until:

```text
Identity status: Verified
DKIM status: Successful
```

## 2. Configure Custom MAIL FROM

Custom MAIL FROM improves alignment and makes bounces cleaner.

Recommended pattern:

```text
bounce.ses.example.com
```

In SES identity settings, enable:

```text
Use a custom MAIL FROM domain
```

SES gives you:

- One MX record.
- One SPF TXT record for the MAIL FROM subdomain.

Add both in DNS.

## 3. Request Production Access

SES starts in sandbox mode. In sandbox mode, SES can only send to verified recipients.

Open:

```text
Amazon SES > Account dashboard > Request production access
```

Recommended request text:

```text
I will use Amazon SES to send email from my self-hosted Ghost website. Emails include member login links, signup confirmations, passwordless login emails, password recovery emails, system notifications, and newsletters only for users who voluntarily subscribe. I will not send unsolicited email. The domain will have SPF, DKIM, DMARC, and a custom MAIL FROM domain configured. Bounces, complaints, deliveries, opens, and unsubscribes are published through SES event publishing and processed by my application. I will monitor bounce and complaint rates and suppress recipients who bounce permanently or complain.
```

Do not send a real newsletter until production access is enabled.

## 4. Create SQS Queues

Create:

```text
ghost-ses-newsletter-queue
ghost-ses-newsletter-events-queue
```

Recommended settings:

```text
Type: Standard
Visibility timeout for send queue: 3600 seconds
Visibility timeout for event queue: 60 seconds or higher
Encryption: AWS managed is fine
```

The send queue stores batches created by Ghost. The event queue receives SES notifications.

## 5. Create SNS Topic For SES Events

Create an SNS topic:

```text
ghost-ses-newsletter-events
```

Subscribe the SQS event queue:

```text
Protocol: Amazon SQS
Endpoint: ghost-ses-newsletter-events-queue ARN
```

SNS must be allowed to send messages to the SQS queue. The console usually offers to add this permission. If you configure it manually, the SQS access policy must allow `sns.amazonaws.com` to call `sqs:SendMessage` from the SNS topic ARN.

## 6. Create Configuration Set

Open:

```text
Amazon SES > Configuration > Configuration sets > Create set
```

Recommended name:

```text
ghost-newsletter
```

Create an event destination:

```text
Destination type: Amazon SNS
SNS topic: ghost-ses-newsletter-events
```

Enable events:

- Send
- Delivery
- Open
- Bounce
- Complaint
- Reject
- Delivery delay
- Subscription

Click tracking is optional. SES click tracking rewrites links through Amazon tracking URLs. Some mailbox providers can treat aggressive link rewriting as suspicious. For Ghost newsletters, a conservative setup is:

```text
Open tracking: enabled
Click tracking: disabled
```

Ghost can still show basic post/member behavior without SES rewriting every link.

## 7. IAM Credentials

Create a dedicated IAM user or role for the proxy. Use the runtime policy in [iam-policies.md](iam-policies.md).

The runtime identity needs:

- `ses:SendEmail`
- `ses:SendBulkEmail`
- SQS send/receive/delete/get attributes on the two queues

It does not need administrator permissions.

## 8. SES SMTP Credentials For Ghost Transactional Email

The proxy is for newsletters. Ghost transactional email should use SES SMTP.

Open:

```text
Amazon SES > SMTP settings > Create SMTP credentials
```

Use those SMTP credentials in Ghost `config.production.json` for magic links, signup emails, password recovery, and staff invites.

## 9. Test With Mailbox Simulator

SES mailbox simulator addresses are useful before sending to real subscribers:

```text
success@simulator.amazonses.com
bounce@simulator.amazonses.com
complaint@simulator.amazonses.com
suppressionlist@simulator.amazonses.com
```

Use them only for controlled testing. They should not be added as real members.

## Final SES Checklist

Before switching Ghost:

- Domain identity verified.
- DKIM successful.
- Custom MAIL FROM verified.
- SPF and DMARC pass.
- Production access enabled.
- Configuration set exists.
- Event destination publishes to SNS/SQS.
- Proxy IAM policy includes `ses:SendBulkEmail`.
- SES SMTP credentials exist for Ghost transactional email.
