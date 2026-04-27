import { startWorker } from "@/lib/core/sqs-worker"
import { QUEUE_URL } from "./aws/awsHelper"
import { handleNewsletterEmailEvent } from "./events-service"
import { validateAndSend } from "./newsletter-service"
import { handleSystemEmailEvent } from "./system-email-notification"

function getPositiveNumber(value: unknown, fallback: number) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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
        handler: handleSystemEmailEvent
    })
}

