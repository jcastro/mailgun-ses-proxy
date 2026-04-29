import { Message } from "@aws-sdk/client-sqs"
import { parseNotificationEvent, NotificationEvent } from "./aws-utils"
import logger from "./logger"

const log = logger.child({ module: "event-processor" })

interface EventProcessorConfig {
    name: string
    lookupMessage: (messageId: string) => Promise<any>
    saveNotification: (event: NotificationEvent) => Promise<any>
    maxRetries?: number
    missingParentRetrySeconds?: number
}

function getPositiveInteger(value: unknown, fallback: number) {
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getNonNegativeNumber(value: unknown, fallback: number) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function getEventAgeSeconds(event: NotificationEvent) {
    const timestamp = event.timestamp.getTime()
    if (!Number.isFinite(timestamp)) return 0

    return Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
}

/**
 * Creates a standardized event handler for SES notification messages.
 * Handles parsing, retry limits, and database dependency checks.
 */
export function createEventProcessor(config: EventProcessorConfig) {
    const {
        name,
        lookupMessage,
        saveNotification,
        maxRetries = getPositiveInteger(process.env.EVENT_MAX_RETRIES, 3),
        missingParentRetrySeconds = getNonNegativeNumber(process.env.EVENT_MISSING_PARENT_RETRY_SECONDS, 120),
    } = config

    return async (message: Message) => {
        if (!message.Body || !message.MessageId) {
            log.warn({ name }, "Received empty SQS message")
            return
        }

        const receiveCount = parseInt(message.Attributes?.ApproximateReceiveCount || "0")
        if (receiveCount > maxRetries) {
            log.info({ name, messageId: message.MessageId, receiveCount, maxRetries }, "Event exceeded max retries, discarding")
            return // Returning success deletes the message from SQS
        }

        const result = parseNotificationEvent(message.MessageId, message.Body)
        
        // Check if the parent message exists in our DB
        const dbMessage = await lookupMessage(result.messageId)
        
        if (!dbMessage) {
            // SES can deliver the event before our local send row is visible, or after
            // a restore/retention cleanup removed the local row. Fresh events get a
            // short retry window; clearly stale orphans are deleted without warning
            // noise because there is no local record left to attach them to.
            const eventAgeSeconds = getEventAgeSeconds(result)
            const retryWindowExpired = eventAgeSeconds > missingParentRetrySeconds

            if (retryWindowExpired) {
                log.info({
                    name,
                    messageId: result.messageId,
                    notificationId: result.notificationId,
                    receiveCount,
                    eventAgeSeconds,
                    missingParentRetrySeconds,
                }, "Event parent message not found after retry window, discarding")
                return // Returning success deletes the message from SQS
            }

            log.debug({
                name,
                messageId: result.messageId,
                notificationId: result.notificationId,
                receiveCount,
                eventAgeSeconds,
                missingParentRetrySeconds,
            }, "Event parent message not found, leaving in queue for retry")
            return "retry" as const
        }

        // Idempotent save (upsert)
        await saveNotification(result)
        
        log.info({ 
            name, 
            messageId: result.messageId, 
            type: result.type,
            notificationId: result.notificationId 
        }, "Processed event successfully")
    }
}
