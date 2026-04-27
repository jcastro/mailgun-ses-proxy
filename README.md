# Mailgun-to-SES Proxy

![build](https://img.shields.io/badge/Build-OK-green)

Dockerized Mailgun-compatible API proxy for Ghost newsletters, backed by Amazon SES, SQS, and MySQL.

This service lets a self-hosted Ghost instance keep using Ghost's Mailgun newsletter integration while sending through Amazon SES. Ghost talks to this proxy as if it were Mailgun; the proxy queues and sends email through SES and exposes Mailgun-like event/suppression endpoints back to Ghost.

## Provenance

This repository is not a from-scratch implementation. It is a modified distribution of [`typetale-app/mailgun-ses-proxy`](https://github.com/typetale-app/mailgun-ses-proxy), kept under the same AGPL-3.0 license. See [NOTICE](NOTICE) for attribution and a summary of changes in this distribution.

## Purpose

Ghost natively integrates with Mailgun for bulk newsletter delivery and analytics. This proxy provides the Mailgun API surface Ghost needs, while using SES for delivery.

## Features

- **Ghost/Mailgun API Compatibility**: Implements the Mailgun v3 routes Ghost uses for newsletters
- **Amazon SES Backend**: Routes all email sending through AWS SES for better deliverability and cost-effectiveness
- **Queue-based Processing**: Uses AWS SQS for reliable email queue management
- **Event Tracking**: Converts SES events to Mailgun-compatible `delivered`, `opened`, `failed`, `complained`, `unsubscribed`, and `clicked` events
- **Suppression Compatibility**: Acknowledges Ghost's Mailgun suppression cleanup calls
- **Database Logging**: Stores email batches, messages, and events in MySQL database
- **Dashboard Analytics**: Shows delivery, open, click, bounce, complaint, unsubscribe, and send-error metrics from stored SES/Mailgun-compatible events
- **Health Monitoring**: Built-in health check endpoints for monitoring
- **Docker First**: Designed to run from a published Docker image

## Architecture

The system consists of several components:

1. **Next.js API Server**: Handles incoming requests from Ghost
2. **AWS SES**: Sends the actual emails
3. **AWS SQS**: Manages email queues and event notifications
4. **MySQL Database**: Stores email batches, messages, and delivery events
5. **Background Processors**: Process email queues and handle SES events

## Prerequisites

Before setting up the server, ensure you have:

- **Docker** and Docker Compose
- **AWS Account** with SES, SQS, and IAM access
- **Verified SES domain or email identity**
- **SES production access** if sending to unverified recipients
- **MySQL** if you do not use the bundled Compose database

## AWS Configuration

For a fuller walkthrough, see [docs/aws-ses.md](docs/aws-ses.md).

### 1. Amazon SES Setup

1. **Verify your sending domain** in AWS SES console
2. **Create Configuration Sets** for tracking:
    - `newsletter-config-set` (for newsletter emails)
    - `system-config-set` (for transactional emails)
3. **Set up SNS topics** for event notifications (optional but recommended)
4. **Request production access** if sending to unverified email addresses

### 2. AWS SQS Setup

Create the following SQS queues:

- `newsletter-buffer-queue` - For buffering newsletter emails for processing
- `newsletter-events-queue` - For SES event notifications from newsletter emails
- `system-events-queue` - For SES event notifications from transactional emails

### 3. Connect SNS to SQS

For each SNS topic, create a subscription to the corresponding SQS queue:

1. Go to SNS Console
2. Select the topic
3. Click "Create subscription"
4. Set protocol to "Amazon SQS"
5. Set the SQS queue

### 4. IAM Permissions

Your AWS credentials need the following permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ses:SendEmail",
                "ses:SendRawEmail",
                "sqs:SendMessage",
                "sqs:ReceiveMessage",
                "sqs:DeleteMessage",
                "sqs:GetQueueAttributes"
            ],
            "Resource": "*"
        }
    ]
}
```

## Environment Configuration

Copy the example environment file and fill in your own values:

```bash
cp .env.example .env
```

Important variables:

- `API_KEY`: the value Ghost will use as the Mailgun API key.
- `DATABASE_URL`: MySQL connection string used by Prisma.
- `NEWSLETTER_QUEUE`: SQS queue URL for outgoing newsletter batches.
- `NEWSLETTER_NOTIFICATION_QUEUE`: SQS queue URL receiving SES event notifications.
- `NEWSLETTER_CONFIGURATION_SET_NAME`: SES configuration set with event publishing enabled.
- `SES_REGION` and `SQS_REGION`: AWS regions for SES and SQS.

## Installation & Setup

### Docker Compose

Build and run the proxy plus MySQL:

```bash
cp .env.example .env
docker compose up -d --build
```

The proxy listens on `127.0.0.1:3000` by default. Change `HOST_BIND` and `HOST_PORT` in `.env` if you need a different binding.

### Standalone Docker

Use this when MySQL already exists elsewhere:

```bash
docker build -f dockerfile -t mailgun-ses-proxy:latest .
docker run --rm -p 127.0.0.1:3000:3000 --env-file .env mailgun-ses-proxy:latest
```

### Local Development

```bash
npm install
npm run db:generate
npm run db:migrate:dev
npm run dev
```

## Publishing An Image

The image is self-contained and starts with:

```bash
bun run start:bun
```

Build an `linux/amd64` image:

```bash
docker buildx build \
  --platform linux/amd64 \
  -f dockerfile \
  -t your-dockerhub-user/mailgun-ses-proxy:latest \
  --push .
```

Then users can set:

```bash
IMAGE=your-dockerhub-user/mailgun-ses-proxy:latest
docker compose up -d
```

Do not bake secrets into the image. All secrets must come from `.env`, Docker secrets, or your deployment platform.

### Production Deployment

In production, keep the proxy private behind your reverse proxy or Docker network. If exposed publicly, always require HTTPS and keep `API_KEY` long and random.

## Ghost Configuration

For more detail, see [docs/ghost.md](docs/ghost.md).

Configure Ghost to use the proxy by setting these environment variables in your Ghost installation:

```bash
# Mailgun Configuration (point to your proxy)
bulkEmail__mailgun__baseUrl=http://your-proxy-server:3000/v3
bulkEmail__mailgun__apiKey=your-secure-api-key-here
bulkEmail__mailgun__domain=your-verified-ses-domain.com

# Email Settings
hostSettings__managedEmail__sendingDomain=your-verified-ses-domain.com
mail__from=noreply@your-verified-ses-domain.com
```

Ghost's `mail` SMTP configuration is still separate and is used for transactional emails such as login links and password recovery. This proxy targets Ghost's Mailgun newsletter/bulk email integration.

## API Endpoints

### Newsletter Endpoints

- `POST /v3/{siteId}/messages` - Send newsletter emails (Mailgun compatible)
- `GET /v3/{siteId}/events` - Fetch SES events formatted like Mailgun events
- `DELETE /v3/{siteId}/suppressions/{type}/{email}` - Acknowledge Ghost suppression cleanup
- `GET /healthcheck` - Health check endpoint
- `GET /stats/{action}` - Email statistics and analytics

### Supported Mailgun Parameters

The proxy supports the Mailgun parameters Ghost sends:

- `from` - Sender email address
- `to` - Recipient email address(es)
- `subject` - Email subject
- `html` - HTML email content
- `text` - Plain text email content
- `v:email-id` - Batch ID for tracking
- `recipient-variables` - Per-recipient replacement data
- `h:Reply-To`, `h:List-Unsubscribe`, `h:List-Unsubscribe-Post`, `h:Auto-Submitted`, `h:X-Auto-Response-Suppress`
- `o:tag`, `o:tracking-opens`

Unsupported Mailgun features are ignored where Ghost does not require them.

### Mailgun-Compatible Events

The events endpoint supports the query shape Ghost uses with Mailgun:

- `event=delivered OR opened OR failed OR unsubscribed OR complained`
- `begin` and `end` as Unix timestamps
- `limit`, `page` or `start`
- `ascending=yes`
- `tags=bulk-email AND my-newsletter-tag`

Returned events include Ghost/Mailgun fields such as `user-variables.email-id`, `message.headers.message-id`, `delivery-status`, `severity`, `reason`, `recipient-domain`, `tags`, click URL, and client info where SES provides it. The Mailgun `message-id` stays aligned with Ghost's stored batch provider id; the SES message id is exposed separately as `x-ses-message-id`.

### Large Newsletter Batches

The proxy is designed for large Ghost newsletter batches. For 5,000+ recipients:

- `RATE_LIMIT` should stay at or below the SES maximum send rate for your account.
- `MAX_CONCURRENT` controls how many SES send operations may be in flight at once.
- `SES_BULK_SEND_ENABLED=true` lets compatible newsletter batches use SES bulk send, reducing SES API calls while still storing a message id for each recipient.
- `SES_BULK_SEND_SIZE` controls the maximum recipients per SES bulk request. SES supports up to 50, which is the default.
- `NEWSLETTER_VISIBILITY_TIMEOUT` should be longer than the expected batch duration. For example, 5,000 recipients at `RATE_LIMIT=20` takes roughly 250 seconds before retries and network latency, so the default `1800` seconds leaves comfortable room.
- `SQS_EVENT_RECEIVE_BATCH_SIZE=10` reduces SQS receive/delete API calls for SES event queues.
- Sent recipients are loaded once per batch and duplicate/already-sent recipients are skipped before enqueuing, which avoids one database lookup per recipient during retries.

## Monitoring & Logging

For Docker deployment and publishing notes, see [docs/docker.md](docs/docker.md).

### Health Checks

Monitor your deployment using the health check endpoint:

```bash
curl http://your-server:3000/healthcheck
```

### Logs

The application uses structured logging with Pino. Logs include:

- Email sending events
- Queue processing status
- Error tracking
- Performance metrics

Available log levels can be configured with `LOG_LEVEL`:

- `fatal`
- `error`
- `warn`
- `info`
- `debug`
- `trace`
- `silent`

### Database Monitoring

Monitor email delivery through the database tables:

- `NewsletterBatch` - Email batch information
- `NewsletterMessages` - Individual email messages
- `NewsletterErrors` - Failed email attempts
- `NewsletterNotifications` - SES delivery events

### Newsletter HTML Persistence

By default, newsletter messages store recipient substitution data in `recipientData` and rely on `NewsletterBatch.contents` as the source HTML/template.

If you need the legacy behavior that persists the fully rendered SES payload for each newsletter message and error row, enable:

```bash
PERSIST_NEWSLETTER_FORMATTED_CONTENTS=true
```

When enabled, the application stores the rendered `SendEmailRequest` JSON in `NewsletterMessages.formatedContents` and `NewsletterErrors.formatedContents`.

This legacy mode can consume a large amount of database storage on high-volume newsletter sends, because the full rendered HTML payload is duplicated for every recipient and every error row. Keep `PERSIST_NEWSLETTER_FORMATTED_CONTENTS=false` unless you explicitly need per-message payload persistence for auditing or debugging.

## Troubleshooting

### Common Issues

1. **SES Sandbox Mode**
    - Ensure you've requested production access in AWS SES
    - Verify all recipient domains in sandbox mode

2. **Queue Processing Issues**
    - Check SQS queue visibility timeout settings
    - Verify AWS credentials and permissions
    - Monitor dead letter queues for failed messages

3. **Database Connection**
    - Ensure MySQL is running and accessible
    - Verify DATABASE_URL format and credentials
    - Check if migrations have been applied

4. **Ghost Integration**
    - Verify the proxy URL is accessible from Ghost
    - Check API key matches between Ghost and proxy
    - Ensure the domain is verified in SES

### Debug Mode

Enable debug logging by setting:

```bash
NODE_ENV=development
```

### Testing Email Delivery

Test the proxy directly:

```bash
curl -X POST http://localhost:3000/v3/your-site-id/messages \
  -u "api:your-api-key" \
  -F "from=test@yourdomain.com" \
  -F "to=recipient@example.com" \
  -F "subject=Test Email" \
  -F "html=<h1>Test Message</h1>"
```

## Performance Considerations

- **Queue Processing**: The system processes emails asynchronously through SQS
- **Rate Limits**: Respects AWS SES sending limits automatically
- **Batch Processing**: Handles large newsletter batches efficiently
- **Error Handling**: Implements retry logic for failed deliveries

## Security

- Use strong API keys for authentication
- Implement proper IAM roles with minimal required permissions
- Keep AWS credentials secure and rotate regularly
- Use HTTPS in production deployments
- Regularly update dependencies for security patches

## License

AGPL-3.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
