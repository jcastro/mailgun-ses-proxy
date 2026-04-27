# Changelog

All notable changes are tracked through GitHub Releases.

## Release process

Create a version tag with one of:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Pushing a `v*` tag runs tests, builds the Docker image, publishes these image tags, and creates a GitHub Release with generated notes:

- `ghcr.io/jcastro/mailgun-ses-proxy:<version>`
- `ghcr.io/jcastro/mailgun-ses-proxy:latest`

## 2.1.2 - 2026-04-27

- Added fallback from SES `SendBulkEmail` to individual `SendEmail` calls when the runtime IAM user lacks bulk-send permission.
- Fixed newsletter error persistence to use the internal batch id, so failed recipients can be recorded reliably.
- Added regression tests for bulk-permission fallback and failure recording.

## 2.1.1 - 2026-04-27

- Added Ghost/Mailgun-compatible newsletter analytics backed by SES events.
- Added Mailgun-like event fields for delivery, opens, clicks, bounces, complaints, unsubscribes, and send errors.
- Added dashboard metrics for newsletter batches and event inspection.
- Optimized large newsletter batch sending and SES/SQS API usage.
- Added Docker/GHCR publishing and public deployment documentation.
