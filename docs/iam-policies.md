# IAM Policies

Use separate credentials for the proxy runtime and for one-time setup tasks.

The runtime user should be narrow. It sends email and reads/writes SQS. It should not be an administrator.

## Runtime Policy

Replace:

- `REGION`
- `ACCOUNT_ID`
- `example.com`
- `links.example.com`, only if SES click/open tracking uses that identity

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSesNewsletterSending",
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendBulkEmail"
      ],
      "Resource": [
        "arn:aws:ses:REGION:ACCOUNT_ID:identity/example.com",
        "arn:aws:ses:REGION:ACCOUNT_ID:identity/links.example.com",
        "arn:aws:ses:REGION:ACCOUNT_ID:configuration-set/ghost-newsletter"
      ]
    },
    {
      "Sid": "AllowNewsletterQueues",
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

If you also use this proxy for transactional events, add the transactional event queue to the SQS resources.

## Alarm Setup Policy

This policy is only needed for the user or role that creates CloudWatch alarms. The proxy runtime does not need these permissions.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowGhostProxyAlarmWrites",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricAlarm"
      ],
      "Resource": "arn:aws:cloudwatch:REGION:ACCOUNT_ID:alarm:ghost-mail-proxy-*"
    },
    {
      "Sid": "AllowGhostProxyAlarmReads",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:DescribeAlarms"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowGhostProxyAlertTopic",
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:ListSubscriptionsByTopic",
        "sns:Subscribe"
      ],
      "Resource": "arn:aws:sns:REGION:ACCOUNT_ID:ghost-mail-proxy-alerts"
    }
  ]
}
```

After creating the SNS email subscription, AWS sends a confirmation email. The subscription does not deliver alarm notifications until that email is confirmed.

## SES SMTP Credentials For Ghost

Ghost transactional email uses SES SMTP credentials, not the SES API access key.

Create SMTP credentials in:

```text
Amazon SES > SMTP settings > Create SMTP credentials
```

Use those values in Ghost's `mail.options.auth.user` and `mail.options.auth.pass`.
