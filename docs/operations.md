# Operations

This page covers day-to-day checks after the proxy is live.

## Health

```bash
curl http://127.0.0.1:3000/healthcheck
docker compose ps
```

Expected:

- Proxy container is healthy.
- Database container is healthy.
- Healthcheck returns HTTP 200.

## Logs

```bash
docker compose logs --tail=200 proxy
```

Important messages:

- `newsletter queued to SQS`: Ghost handed a newsletter to the proxy.
- `processing newsletter batch`: the sender started a batch.
- `newsletter batch completed`: sender finished a batch.
- `Processed event successfully`: SES event was stored for Ghost.
- `recipient added to local suppression list`: complaint or bounce was suppressed.
- `recipient skipped due to local suppression`: a future send avoided SES for a suppressed recipient.

## SQS Queues

The send queue should usually be empty after a batch completes.

The event queue may briefly fill while SES sends delivery/open/bounce events, then drain.

Alarm-worthy states:

- Send queue has visible messages for many minutes.
- Event queue keeps growing.
- Oldest message age increases continuously.

## Suppression Behavior

The proxy keeps a local suppression table:

```text
SuppressedRecipient
```

Rules:

- `Complaint` events are suppressed immediately.
- Permanent `Bounce` events are suppressed immediately.
- Transient `Bounce` events increment `failureCount`.
- Transient bounces become active suppressions after `SUPPRESSION_TRANSIENT_BOUNCE_THRESHOLD`, default `3`.

Suppressed members are not deleted from Ghost. Future sends are skipped locally and Ghost receives a compatible `failed` event.

## CloudWatch Alarms

Recommended alarms:

- Send queue oldest message age.
- Send queue visible backlog.
- Event queue oldest message age.
- Event queue visible backlog.
- SES reputation bounce rate.
- SES reputation complaint rate.
- SES rejects.

Create them with a setup user or role that has the policy from [iam-policies.md](iam-policies.md).

Confirm the SNS email subscription after AWS sends the confirmation email.

## Large Send Checklist

Before a large send:

1. Confirm SES production access is enabled.
2. Confirm SES daily quota and max send rate.
3. Keep `RATE_LIMIT` below the max send rate.
4. Check the proxy is healthy.
5. Check SQS queues are empty.
6. Send a test email to yourself.

During the send:

1. Watch proxy logs.
2. Watch send queue and event queue depth.
3. Watch SES bounce and complaint rates.
4. Do not restart Ghost or the proxy unless the queue is stuck.

After the send:

1. Wait for SES events to settle.
2. Confirm Ghost analytics imported events.
3. Review failed and complained counts.
4. Confirm unsubscribe links work.
5. Keep an eye on reputation metrics for the next few hours.

## Safe Update Procedure

```bash
cd /opt/mailgun-ses-proxy
cp docker-compose.yaml docker-compose.yaml.backup.$(date -u +%Y%m%dT%H%M%SZ)
docker compose pull proxy
docker compose up -d proxy
curl http://127.0.0.1:3000/healthcheck
docker compose logs --tail=100 proxy
```

If the server uses legacy `docker-compose` v1 and fails with `ContainerConfig`, remove only the stopped proxy container and recreate it:

```bash
docker rm old_proxy_container_name
docker-compose up -d proxy
```

Do not remove the database container or database volume.
