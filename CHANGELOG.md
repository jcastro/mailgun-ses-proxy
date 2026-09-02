# Changelog

All notable changes are tracked through GitHub Releases.

## Unreleased

- Refresh supported runtime dependencies, including Next.js security patches; Docker now installs the same npm lockfile tested in CI instead of a separate Bun dependency graph.
- Build and smoke-test the Docker image with an isolated MySQL database on every pull request, without publishing it.
- Close extension-based API authentication bypasses and verify dashboard JWT signatures at the shared request boundary.
- Remove default dashboard credentials and public credential replacement; require explicit provisioning and operator-only legacy recovery. Add bounded login throttling and secure production cookies.
- Preserve existing password hashes and signing-secret bytes; support Unicode session names and reject malformed/expired sessions.
- Return 503 for newsletter queue/database outages and keep 400 for invalid input; redact internal error messages from send APIs.
- Replace ineffective dashboard configuration writes with an authenticated, read-only view of the actual deployment variable names. Existing database settings are retained but unused.

- Commit SES event storage and suppression changes atomically, so redelivery cannot count the same transient bounce twice.
- Keep complaint/permanent-bounce suppressions active when a delayed transient bounce arrives; use atomic failure increments.
- Deduplicate SNS redeliveries using their SNS notification ID without collapsing legitimate repeated opens and clicks. Raw delivery retains SQS identity.
- Retry known-message events after database outages instead of deleting them solely because their receive count is high. Configure SQS dead-letter queues for persistent failures.
- Add real MySQL integration tests to pull-request CI.

## 2.1.14 - 2026-06-01

- Added a timeout around each SQS long-poll request so event workers recover if an AWS SDK receive call hangs.
- Recreated the SQS receive command on every poll cycle instead of reusing a single command object indefinitely.
- Added explicit warning logs when an SQS poll times out and is retried.

## 2.1.13 - 2026-05-10

- Added SES tag normalization to event parsing so processors can distinguish Ghost newsletter events from unrelated SMTP traffic.
- Changed the newsletter event worker to discard non-Ghost-newsletter SES events without retrying or logging them as orphaned records.
- Added regression coverage for direct SMTP events, such as Discourse notification emails, sharing the same SES event queue.

## 2.1.12 - 2026-04-30

- Reduced warning noise from stale SES event notifications whose local message row no longer exists.
- Added `EVENT_MISSING_PARENT_RETRY_SECONDS` and `EVENT_MAX_RETRIES` tuning knobs for event queue retry behavior.
- Added regression coverage for stale orphan event cleanup.

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

## 2.1.11 - 2026-04-29

- Treat the transactional SES event queue as optional at startup, logging its absence as informational instead of warning noise.
- Keeps warnings reserved for missing required newsletter queues and real processing problems.

## 2.1.10 - 2026-04-28

- Downgraded stale SES event discard logging from error to warning, because deleting an event after the retry budget is expected recovery behavior.
- Updated the GitHub release workflow so future release notes include the matching `CHANGELOG.md` section automatically.

## 2.1.9 - 2026-04-28

- Changed SES event processing so events whose parent message is missing are retried quietly and then discarded after the retry budget, avoiding noisy SQS retry loops after restores or database retention cleanup.
- Added regression coverage for stale SES event handling.
- Updated Docker docs to recommend Docker's official Engine repository and Compose plugin, with backup guidance before replacing distro Docker packages.

## 2.1.8 - 2026-04-28

- Added a detailed Amazon SES production-access request template based on a real approved Ghost migration use case.

## 2.1.7 - 2026-04-28

- Added a Docker Compose update helper that detects Compose v1/v2 and works around the legacy `docker-compose` v1 `ContainerConfig` recreate bug.
- Changed the default Compose deployment to use the published GHCR image instead of trying to build locally.
- Added a separate `docker-compose.dev.yaml` override for source builds.
- Updated deployment and operations docs with the safe update flow.

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
