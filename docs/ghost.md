# Ghost Configuration

Ghost has two separate email paths:

- Transactional email via `mail`/SMTP for magic links, password recovery, staff invites, and system mail.
- Newsletter/bulk email via the Mailgun integration.

This proxy targets the Mailgun newsletter/bulk email path.

## Environment Variables

Configure Ghost's Mailgun settings to point to the proxy:

```bash
bulkEmail__mailgun__baseUrl=http://proxy-host:3000/v3
bulkEmail__mailgun__apiKey=your-proxy-api-key
bulkEmail__mailgun__domain=example.com
```

The `apiKey` value must match the proxy `API_KEY`.

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
