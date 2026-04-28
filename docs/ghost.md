# Ghost Configuration

Ghost has two separate email paths:

- Transactional email via `mail`/SMTP for magic links, password recovery, staff invites, and system mail.
- Newsletter/bulk email via the Mailgun integration.

This proxy targets the Mailgun newsletter/bulk email path.

## Recommended Setup

Use SES SMTP for transactional email and this proxy for newsletters:

```text
Ghost transactional email -> Amazon SES SMTP
Ghost newsletters -> Mailgun-compatible proxy -> Amazon SES API
```

Do not remove the transactional SMTP config when you configure the newsletter proxy.

## Environment Variables

Configure Ghost's Mailgun settings to point to the proxy:

```bash
bulkEmail__mailgun__baseUrl=http://proxy-host:3000/v3
bulkEmail__mailgun__apiKey=your-proxy-api-key
bulkEmail__mailgun__domain=example.com
```

The `apiKey` value must match the proxy `API_KEY`.

With Ghost CLI, this usually looks like:

```bash
ghost config bulkEmail.mailgun.baseUrl http://127.0.0.1:3000/v3
ghost config bulkEmail.mailgun.apiKey "your-proxy-api-key"
ghost config bulkEmail.mailgun.domain example.com
ghost restart
```

If you edit `config.production.json` directly, the equivalent shape is:

```json
{
  "bulkEmail": {
    "mailgun": {
      "baseUrl": "http://127.0.0.1:3000/v3",
      "apiKey": "your-proxy-api-key",
      "domain": "example.com"
    }
  }
}
```

If Ghost and the proxy are on the same Docker network, use the service name:

```bash
bulkEmail__mailgun__baseUrl=http://mailgun-ses-proxy:3000/v3
```

If the proxy is behind a reverse proxy, use the HTTPS URL:

```bash
bulkEmail__mailgun__baseUrl=https://mailgun-proxy.example.com/v3
```

## Supported Ghost Newsletter Flow

The proxy supports the Mailgun calls Ghost uses for:

- Sending newsletter batches
- Per-recipient replacement variables
- List-Unsubscribe headers
- Event polling for delivered/opened/failed/complained/unsubscribed/clicked events
- Suppression cleanup calls

## Transactional Email

Keep Ghost transactional email configured separately. For SES SMTP, Ghost's production config usually looks like:

```json
{
  "mail": {
    "transport": "SMTP",
    "options": {
      "host": "email-smtp.REGION.amazonaws.com",
      "port": 587,
      "secure": false,
      "auth": {
        "user": "SES_SMTP_USERNAME",
        "pass": "SES_SMTP_PASSWORD"
      }
    },
    "from": "Example <noreply@example.com>"
  }
}
```

Restart Ghost after changing its email configuration.

## Testing From Ghost Admin

1. Open a draft post.
2. Use Ghost's email preview/test send first.
3. Send to one or two test members.
4. Open the emails.
5. Wait a few minutes for analytics import.
6. Confirm opens, deliveries, failures, and unsubscribes appear in Ghost.

For a full migration checklist, see [migration-from-mailgun.md](migration-from-mailgun.md).

## Common Problems

### Newsletter Sends But Stats Stay Empty

Check:

- `NEWSLETTER_CONFIGURATION_SET_NAME` matches the SES configuration set.
- SES event destination is enabled.
- SNS publishes to the SQS event queue.
- The proxy event worker is running.
- Ghost points to `/v3`, not the root URL.

### Transactional Emails Fail

This is usually unrelated to the proxy. Check Ghost's `mail` SMTP config and SES SMTP credentials.

### Emails Go To Spam

Check:

- DKIM pass.
- SPF pass.
- DMARC pass.
- Custom MAIL FROM.
- Complaint rate.
- Link tracking configuration.
- Content and reputation.
