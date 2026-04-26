# Docker Deployment

The application is designed to run as a Docker image. Runtime configuration comes from environment variables.

## Compose Deployment

```bash
cp .env.example .env
docker compose up -d --build
```

By default the proxy binds to localhost:

```text
127.0.0.1:3000
```

This is intentional. Put a reverse proxy in front of it if Ghost runs on another host, and use HTTPS.

## Prebuilt Image

If you publish the image to GHCR or Docker Hub:

```bash
IMAGE=ghcr.io/OWNER/mailgun-ses-proxy:latest
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

## Healthcheck

The image exposes:

```text
GET /healthcheck
```

Docker also runs the same healthcheck inside the container.

## Publishing

The included GitHub Actions workflow builds and publishes a multi-arch image to GitHub Container Registry on pushes to `main` and on tags.

Manual build:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f dockerfile \
  -t ghcr.io/OWNER/mailgun-ses-proxy:latest \
  --push .
```
