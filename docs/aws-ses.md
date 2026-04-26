# Amazon SES Setup

This proxy requires SES, SQS, and SES event publishing. The recommended region is the region closest to your audience or infrastructure.

## SES Identity

1. Open Amazon SES in your chosen region.
2. Create a domain identity for the domain you will send from.
3. Enable Easy DKIM.
4. Add the SES DNS records at your DNS provider.
5. Wait until the identity and DKIM status are verified.

If you use a custom MAIL FROM domain, add the MX and SPF records SES provides. A common pattern is:

```text
bounce.ses.example.com
```

## Configuration Set

Create a configuration set for newsletters, for example:

```text
ghost-newsletter
```

Enable event publishing for at least:

- Send
- Delivery
- Open
- Click
- Bounce
- Complaint
- Reject
- DeliveryDelay

Send these events to an SNS topic, then subscribe the SQS event queue to that topic.

## SQS Queues

Create two SQS queues:

```text
ghost-ses-newsletter-queue
ghost-ses-newsletter-events-queue
```

The first queue stores newsletter batches to send. The second queue receives SES event notifications.

## IAM Permissions

Create a dedicated IAM user or role for the proxy. Keep permissions narrow:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ses:SendEmail"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": [
        "arn:aws:sqs:REGION:ACCOUNT_ID:ghost-ses-newsletter-queue",
        "arn:aws:sqs:REGION:ACCOUNT_ID:ghost-ses-newsletter-events-queue"
      ]
    }
  ]
}
```

## Sandbox

SES starts in sandbox mode. Request production access before switching Ghost to this proxy for real subscribers. In sandbox mode, SES can only send to verified recipients.
