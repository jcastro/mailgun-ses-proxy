# Quickstart

This guide gets a self-hosted Ghost site sending newsletters through Amazon SES while Ghost still thinks it is talking to Mailgun.

Use this when you already have:

- A self-hosted Ghost installation.
- A domain managed in DNS.
- An AWS account.
- Docker on the server that will run the proxy.

## 1. Choose Names

Recommended example values:

```text
Sending domain: example.com
SES region: eu-west-1
Custom MAIL FROM: bounce.ses.example.com
Configuration set: ghost-newsletter
Send queue: ghost-ses-newsletter-queue
Event queue: ghost-ses-newsletter-events-queue
Proxy URL from Ghost: http://127.0.0.1:3000/v3
```

If Ghost and the proxy run on different machines, put the proxy behind HTTPS and use that HTTPS URL instead.

## 2. Configure Amazon SES

Follow [aws-ses.md](aws-ses.md). The short version is:

1. Verify your sending domain in SES.
2. Enable Easy DKIM and publish the DNS records.
3. Configure a custom MAIL FROM domain.
4. Request production access if your account is still in sandbox.
5. Create the `ghost-newsletter` configuration set.
6. Enable SES event publishing to SNS/SQS.
7. Create an IAM user or role for the proxy using the policy in [iam-policies.md](iam-policies.md).

Do not switch Ghost until SES is verified and production access is enabled.

## 3. Create Queues

Create two SQS queues in the same AWS region:

```text
ghost-ses-newsletter-queue
ghost-ses-newsletter-events-queue
```

The send queue stores newsletter batches. The event queue receives SES notifications for accepted, delivered, opened, bounced, complained, and unsubscribed events.

## 4. Run The Proxy

Create a directory on your server:

```bash
mkdir -p /opt/mailgun-ses-proxy
cd /opt/mailgun-ses-proxy
```

Download `docker-compose.yaml` and `.env.example` from this repository, then create your runtime `.env`:

```bash
cp .env.example .env
```

Edit `.env` and set at least:

```env
API_KEY=replace-with-a-long-random-secret
MYSQL_PASSWORD=replace-me
MYSQL_ROOT_PASSWORD=replace-me-root
DATABASE_URL=mysql://mailgun_ses_proxy:replace-me@db:3306/mailgun_ses_proxy

AWS_ACCESS_KEY_ID=replace-me
AWS_SECRET_ACCESS_KEY=replace-me
SES_REGION=eu-west-1
SQS_REGION=eu-west-1

NEWSLETTER_CONFIGURATION_SET_NAME=ghost-newsletter
NEWSLETTER_QUEUE=https://sqs.eu-west-1.amazonaws.com/ACCOUNT_ID/ghost-ses-newsletter-queue
NEWSLETTER_NOTIFICATION_QUEUE=https://sqs.eu-west-1.amazonaws.com/ACCOUNT_ID/ghost-ses-newsletter-events-queue

RATE_LIMIT=10
MAX_CONCURRENT=4
SES_BULK_SEND_ENABLED=true
SES_BULK_SEND_SIZE=10

IMAGE=ghcr.io/jcastro/mailgun-ses-proxy:latest
HOST_BIND=127.0.0.1
HOST_PORT=3000
```

Start it:

```bash
docker compose up -d
```

Check health:

```bash
curl http://127.0.0.1:3000/healthcheck
```

Expected response:

```json
{"status":200}
```

## 5. Configure Ghost

Set Ghost's Mailgun newsletter integration to the proxy:

```bash
ghost config bulkEmail.mailgun.baseUrl http://127.0.0.1:3000/v3
ghost config bulkEmail.mailgun.apiKey "replace-with-the-same-api-key"
ghost config bulkEmail.mailgun.domain example.com
ghost restart
```

Keep transactional email configured separately through SES SMTP:

```json
"mail": {
  "transport": "SMTP",
  "options": {
    "host": "email-smtp.eu-west-1.amazonaws.com",
    "port": 587,
    "secure": false,
    "auth": {
      "user": "SES_SMTP_USERNAME",
      "pass": "SES_SMTP_PASSWORD"
    }
  },
  "from": "Example <noreply@example.com>"
}
```

See [ghost.md](ghost.md) for more options.

## 6. Test Safely

Before sending to all members:

1. Send a Ghost newsletter test to yourself.
2. Confirm the message arrives.
3. Check headers for SPF, DKIM, and DMARC pass.
4. Open the message.
5. Wait for Ghost analytics to show delivery/open events.
6. Send to a small member segment.
7. Check proxy logs and SQS queues.

Useful checks:

```bash
docker compose ps
docker compose logs --tail=100 proxy
curl http://127.0.0.1:3000/healthcheck
```

## 7. Keep Mailgun During Transition

Do not delete Mailgun DNS records or cancel Mailgun immediately. Keep it for 7 to 15 days while you verify:

- Newsletters send successfully.
- Ghost stats update.
- Magic links and member emails still work through SMTP.
- Bounces and complaints are handled.
- Unsubscribe links work.

After that, remove the old Mailgun DNS records and cancel Mailgun.
