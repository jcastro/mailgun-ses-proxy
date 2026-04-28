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

## 2.1.6 - 2026-04-28

- Added step-by-step setup documentation for Ghost, Amazon SES, Cloudflare DNS, IAM, Docker deployment, operations, and Mailgun migration.
- Added a quickstart guide for first-time users.
- Added least-privilege IAM examples for proxy runtime and CloudWatch alarm setup.
- Updated GitHub Actions so version tags build and publish the matching GHCR image before creating the release.

## 2.1.5 - 2026-04-28

- Added local suppression handling for SES complaints, permanent bounces, and repeated transient bounces.
- Skips locally suppressed recipients before calling SES and emits Mailgun-compatible failed events for Ghost analytics.
- Added database migration and regression coverage for suppression behavior.

## 2.1.4 - 2026-04-28

- Lowered default newsletter throughput settings so new deployments stay safely below common SES send-rate quotas.
- Reduced default SES bulk recipient batch size to avoid large recipient bursts on accounts with low `MaxSendRate`.
- Documented SES open tracking versus click link rewriting for Ghost newsletter deliverability.
- Added `ses:SendBulkEmail` to the sample least-privilege IAM policy.

## 2.1.3 - 2026-04-27

- Extended SES bulk-send fallback detection to cover `SendBulkTemplatedEmail` authorization errors.
- Switched the release workflow to CI plus GitHub Releases only; Docker images are now built and pushed locally to GHCR.
- Updated Docker publishing docs for local `linux/amd64` image builds.

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
