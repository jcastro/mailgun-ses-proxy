# Docker Deployment

The application is designed to run as a Docker image. Runtime configuration comes from environment variables.

## Compose Deployment

```bash
cp .env.example .env
./scripts/compose-update.sh
```

By default the proxy binds to localhost:

```text
127.0.0.1:3000
```

This is intentional. Put a reverse proxy in front of it if Ghost runs on another host, and use HTTPS.

## Install Docker

For production servers, install Docker Engine from Docker's official apt repository rather than the Ubuntu `docker.io` package. The official package includes the modern Compose plugin, so the command is `docker compose` instead of the deprecated Python `docker-compose` v1.

Follow Docker's official guide for your OS:

- <https://docs.docker.com/engine/install/ubuntu/>

Ubuntu quick install summary:

```bash
sudo apt update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

If the server already has Docker data, back up volumes before changing packages:

```bash
sudo docker compose ps
sudo docker run --rm -v mailgun-ses-proxy_proxy-db:/volume -v "$PWD":/backup alpine \
  sh -c 'cd /volume && tar czf /backup/proxy-db-volume-backup.tgz .'
```

When replacing distro packages, use `apt remove` for conflicting packages. Avoid `apt purge docker.io` on an existing host unless you intentionally want to remove Docker package state and have already backed up all Docker volumes.

## Prebuilt Image

Use the published image:

```bash
IMAGE=ghcr.io/jcastro/mailgun-ses-proxy:latest
./scripts/compose-update.sh
```

For a pinned production deploy, prefer a version tag:

```bash
IMAGE=ghcr.io/jcastro/mailgun-ses-proxy:v2.1.11
./scripts/compose-update.sh
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
./scripts/compose-update.sh
curl http://127.0.0.1:3000/healthcheck
```

The container runs Prisma migrations on startup.

## Docker Compose Compatibility

Docker Compose v2 is recommended:

```bash
docker compose version
```

Expected output should look like:

```text
Docker Compose version v2.x.x
```

Some older servers still have the deprecated Python `docker-compose` v1. With modern Docker Engine versions, v1 can fail during container recreation with:

```text
KeyError: 'ContainerConfig'
```

This is a Compose v1 recreate bug, not an application failure. The safe update helper detects v1 and removes only the proxy container before recreating it. It does not remove the MySQL container or the database volume:

```bash
./scripts/compose-update.sh
```

For local source builds, use the development override:

```bash
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d --build
```

## Large Batch Tuning

For newsletter batches around 5,000 recipients or more, tune these values to match your SES quota:

```env
RATE_LIMIT=10
MAX_CONCURRENT=4
NEWSLETTER_VISIBILITY_TIMEOUT=3600
SES_BULK_SEND_ENABLED=true
SES_BULK_SEND_SIZE=10
SQS_EVENT_RECEIVE_BATCH_SIZE=10
EVENT_MAX_RETRIES=3
EVENT_MISSING_PARENT_RETRY_SECONDS=120
SUPPRESSION_TRANSIENT_BOUNCE_THRESHOLD=3
```

`RATE_LIMIT` should not exceed the SES maximum send rate. `NEWSLETTER_VISIBILITY_TIMEOUT` must be longer than the time needed to send one batch; otherwise SQS may redeliver the same batch while it is still running.

When `SES_BULK_SEND_ENABLED` is enabled, compatible Ghost newsletter payloads are sent through SES bulk requests. Rate limiting is still counted by recipient, not by API request, so `RATE_LIMIT=10` remains 10 recipients per second even when `SES_BULK_SEND_SIZE=10`.

SES supports up to 50 recipients per bulk request, but accounts with lower send rates can be constrained by that send rate. Keep `SES_BULK_SEND_SIZE` at or below your SES maximum send rate unless you have tested larger bursts safely.

`SUPPRESSION_TRANSIENT_BOUNCE_THRESHOLD` controls how many transient bounces are tolerated before a recipient is locally suppressed. Complaints and permanent bounces are suppressed immediately.

`EVENT_MISSING_PARENT_RETRY_SECONDS` controls how long an SES event whose local message row is missing should be retried. Fresh events can race the database briefly; old orphan events are discarded quietly after this window so logs stay useful after restores, test runs, or retention cleanup.

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
