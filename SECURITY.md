# Security

## Secrets

Do not commit real values for:

- AWS access keys
- SMTP credentials
- `API_KEY`
- `DATABASE_URL`
- Dashboard JWT secrets
- Cloudflare tokens
- SSH keys or passwords

Use `.env` locally and keep `.env.example` as the public template.

## Network Exposure

The Docker Compose file binds the proxy to `127.0.0.1` by default. If you expose it publicly, put it behind HTTPS and keep `API_KEY` long and random.

## IAM

Use a dedicated IAM user or role with only the SES/SQS permissions needed by the proxy.

## Reporting Issues

For private deployments, report vulnerabilities through the repository's private security channel or directly to the repository owner.
