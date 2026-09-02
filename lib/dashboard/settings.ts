// Explicit allowlist: never expose credentials, API keys or database URLs.
const VISIBLE_SETTINGS = [
    ["NEWSLETTER_QUEUE", "Newsletter queue"],
    ["NEWSLETTER_NOTIFICATION_QUEUE", "Newsletter event queue"],
    ["TRANSACTIONAL_NOTIFICATION_QUEUE", "Transactional event queue"],
    ["SES_REGION", "SES region"],
    ["SES_TRANSACTIONAL_REGION", "Transactional SES region"],
    ["SQS_REGION", "SQS region"],
    ["NEWSLETTER_CONFIGURATION_SET_NAME", "Newsletter configuration set"],
    ["TRANSACTIONAL_CONFIGURATION_SET_NAME", "Transactional configuration set"],
    ["RATE_LIMIT", "Recipient rate limit"],
    ["MAX_CONCURRENT", "Concurrent send operations"],
    ["SES_BULK_SEND_SIZE", "Bulk send size"],
    ["SES_BULK_SEND_ENABLED", "Bulk sending"],
    ["PERSIST_NEWSLETTER_FORMATTED_CONTENTS", "Persist rendered messages"],
    ["SYSTEM_FROM_ADDRESS", "System sender"],
] as const

export function getDeploymentSettings() {
    return VISIBLE_SETTINGS.map(([key, label]) => ({
        key, label, value: process.env[key] ?? "", source: "environment" as const,
    }))
}
