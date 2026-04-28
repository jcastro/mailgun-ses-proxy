# Docker Deployment

The application is designed to run as a Docker image. Runtime configuration comes from environment variables.

## Compose Deployment

```bash
cp .env.example .env
docker compose up -d
```

By default the proxy binds to localhost:

```text
127.0.0.1:3000
```

This is intentional. Put a reverse proxy in front of it if Ghost runs on another host, and use HTTPS.

## Prebuilt Image

Use the published image:

```bash
IMAGE=ghcr.io/jcastro/mailgun-ses-proxy:latest
docker compose up -d
```

For a pinned production deploy, prefer a version tag:

```bash
IMAGE=ghcr.io/jcastro/mailgun-ses-proxy:v2.1.5
docker compose up -d
```

## Required Environment

At minimum, configure:

- `API_KEY`
- `DATABASE_URL`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `SES_REGION`
- `SQS_REGION`
- `NEWSLETTER_CONFIGURATION_SET_NAME`
- `NEWSLETTER_QUEUE`
- `NEWSLETTER_NOTIFICATION_QUEUE`

See `.env.example` for all available options.

## Updating

```bash
docker compose pull proxy
docker compose up -d proxy
curl http://127.0.0.1:3000/healthcheck
```

The container runs Prisma migrations on startup.

Legacy servers using `docker-compose` v1 can hit a known recreate error named `ContainerConfig`. If that happens, remove only the stopped proxy container and run `docker-compose up -d proxy` again. Do not remove the database container or volume.

## Large Batch Tuning

For newsletter batches around 5,000 recipients or more, tune these values to match your SES quota:

```env
RATE_LIMIT=10
MAX_CONCURRENT=4
NEWSLETTER_VISIBILITY_TIMEOUT=3600
SES_BULK_SEND_ENABLED=true
SES_BULK_SEND_SIZE=10
SQS_EVENT_RECEIVE_BATCH_SIZE=10
SUPPRESSION_TRANSIENT_BOUNCE_THRESHOLD=3
```

`RATE_LIMIT` should not exceed the SES maximum send rate. `NEWSLETTER_VISIBILITY_TIMEOUT` must be longer than the time needed to send one batch; otherwise SQS may redeliver the same batch while it is still running.

When `SES_BULK_SEND_ENABLED` is enabled, compatible Ghost newsletter payloads are sent through SES bulk requests. Rate limiting is still counted by recipient, not by API request, so `RATE_LIMIT=10` remains 10 recipients per second even when `SES_BULK_SEND_SIZE=10`.

SES supports up to 50 recipients per bulk request, but accounts with lower send rates can be constrained by that send rate. Keep `SES_BULK_SEND_SIZE` at or below your SES maximum send rate unless you have tested larger bursts safely.

`SUPPRESSION_TRANSIENT_BOUNCE_THRESHOLD` controls how many transient bounces are tolerated before a recipient is locally suppressed. Complaints and permanent bounces are suppressed immediately.

## Healthcheck

The image exposes:

```text
GET /healthcheck
```

Docker also runs the same healthcheck inside the container.

## Publishing

The normal release flow is:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Pushing a `v*` tag runs CI, builds the `linux/amd64` image in GitHub Actions, pushes it to GHCR, and creates a GitHub Release.

Manual local publishing is also supported:

Manual build:

```bash
docker buildx build \
  --platform linux/amd64 \
  -f dockerfile \
  -t ghcr.io/OWNER/mailgun-ses-proxy:vX.Y.Z \
  -t ghcr.io/OWNER/mailgun-ses-proxy:latest \
  --push .
```

Then create and push the matching version tag if you want a GitHub Release:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Each release has a matching image tag:

```text
ghcr.io/OWNER/mailgun-ses-proxy:vX.Y.Z
```
