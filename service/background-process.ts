import { startWorker } from "@/lib/core/sqs-worker"
import { MessageSystemAttributeName } from "@aws-sdk/client-sqs"
import { QUEUE_URL } from "./aws/awsHelper"
import { handleNewsletterEmailEvent } from "./events-service"
import { validateAndSend } from "./newsletter-service"
import { handleSystemEmailEvent } from "./system-email-notification"

function getPositiveNumber(value: unknown, fallback: number) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getBatchSize(value: unknown, fallback: number) {
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(10, parsed) : fallback
}

/**
 * Processes the newsletter queue (Ghost CMS batches).
 * Uses a long visibility timeout to handle large batch sends.
 */
export async function processNewsletterQueue() {
    await startWorker({
        name: "newsletter-sender",
        queueUrl: QUEUE_URL.NEWSLETTER!,
        visibilityTimeout: getPositiveNumber(process.env.NEWSLETTER_VISIBILITY_TIMEOUT, 1800),
        receiveBatchSize: getBatchSize(process.env.NEWSLETTER_WORKER_BATCH_SIZE, 1),
        messageAttributeNames: ["siteId", "from"],
        handler: validateAndSend
    })
}

/**
 * Processes delivery/bounce events for newsletter emails.
 */
export async function processNewsletterEventsQueue() {
    await startWorker({
        name: "newsletter-events",
        queueUrl: QUEUE_URL.NEWSLETTER_NOTIFICATION!,
        receiveBatchSize: getBatchSize(process.env.SQS_EVENT_RECEIVE_BATCH_SIZE, 10),
        systemAttributeNames: [MessageSystemAttributeName.ApproximateReceiveCount],
        handler: handleNewsletterEmailEvent
    })
}

/**
 * Processes delivery/bounce events for system/transactional emails.
 */
export async function processSystemEventsQueue() {
    await startWorker({
        name: "system-events",
        queueUrl: QUEUE_URL.SYSTEM_NOTIFICATION!,
        receiveBatchSize: getBatchSize(process.env.SQS_EVENT_RECEIVE_BATCH_SIZE, 10),
        systemAttributeNames: [MessageSystemAttributeName.ApproximateReceiveCount],
        handler: handleSystemEmailEvent
    })
}
