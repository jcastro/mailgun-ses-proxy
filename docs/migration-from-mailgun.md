# Migration From Mailgun

The safest migration keeps Mailgun working until SES is fully proven.

## Phase 1: Prepare SES

1. Choose the SES region.
2. Verify the sending domain in SES.
3. Enable DKIM.
4. Configure custom MAIL FROM.
5. Publish DNS records.
6. Request SES production access.
7. Create SQS queues.
8. Create the SES configuration set.
9. Connect SES event publishing to SNS/SQS.
10. Create proxy IAM credentials.

Do not remove Mailgun DNS yet.

## Phase 2: Deploy Proxy

1. Deploy the proxy with Docker.
2. Confirm `/healthcheck` works.
3. Confirm SQS workers start.
4. Send to SES mailbox simulator addresses if desired.
5. Send a Ghost test newsletter to yourself.

## Phase 3: Switch Ghost Newsletters

Change Ghost's Mailgun newsletter configuration:

```bash
ghost config bulkEmail.mailgun.baseUrl http://127.0.0.1:3000/v3
ghost config bulkEmail.mailgun.apiKey "your-proxy-api-key"
ghost config bulkEmail.mailgun.domain example.com
ghost restart
```

Keep Ghost transactional SMTP configured separately.

## Phase 4: Validate

Test:

- Magic link login.
- Password recovery.
- Member signup.
- Test newsletter.
- Small segment newsletter.
- Open tracking.
- Bounce/complaint processing.
- Unsubscribe link.

Check email headers:

- SPF pass.
- DKIM pass.
- DMARC pass.
- Custom MAIL FROM used as Return-Path.

## Phase 5: First Full Send

Before sending to everyone:

1. Confirm SES quota is high enough.
2. Confirm `RATE_LIMIT` is below SES max send rate.
3. Confirm queues are empty.
4. Confirm proxy health.

After sending:

1. Wait for delivery events.
2. Confirm Ghost analytics updates.
3. Review bounces and complaints.
4. Confirm local suppressions are created.

## Phase 6: Retire Mailgun

Keep Mailgun for 7 to 15 days after the first successful full send.

Then:

1. Remove Mailgun-only DNS records.
2. Remove old Mailgun API keys from Ghost/config backups.
3. Cancel Mailgun.
4. Keep SES alarms active.

## Rollback

If something goes wrong before Mailgun is cancelled:

1. Point Ghost `bulkEmail.mailgun.baseUrl` back to Mailgun.
2. Restore the Mailgun API key/domain.
3. Restart Ghost.
4. Keep SES DNS records in place while debugging.

Do not delete SES records during rollback unless you are abandoning SES completely.
