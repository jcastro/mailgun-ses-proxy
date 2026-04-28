import { Message } from "@aws-sdk/client-sqs"
import { parseNotificationEvent, NotificationEvent } from "./aws-utils"
import logger from "./logger"

const log = logger.child({ module: "event-processor" })

interface EventProcessorConfig {
    name: string
    lookupMessage: (messageId: string) => Promise<any>
    saveNotification: (event: NotificationEvent) => Promise<any>
    maxRetries?: number
}

/**
 * Creates a standardized event handler for SES notification messages.
 * Handles parsing, retry limits, and database dependency checks.
 */
export function createEventProcessor(config: EventProcessorConfig) {
    const { name, lookupMessage, saveNotification, maxRetries = 3 } = config

    return async (message: Message) => {
        if (!message.Body || !message.MessageId) {
            log.warn({ name }, "Received empty SQS message")
            return
        }

        const receiveCount = parseInt(message.Attributes?.ApproximateReceiveCount || "0")
        if (receiveCount > maxRetries) {
            log.error({ name, messageId: message.MessageId, receiveCount }, "Event exceeded max retries, discarding")
            return // Returning success deletes the message from SQS
        }

        const result = parseNotificationEvent(message.MessageId, message.Body)
        
        // Check if the parent message exists in our DB
        const dbMessage = await lookupMessage(result.messageId)
        
        if (!dbMessage) {
            // SES can deliver the event before our local send row is visible, or after
            // a restore/retention cleanup removed the local row. Retry quietly first,
            // then let the max-retry guard above delete stale events.
            log.warn({
                name,
                messageId: result.messageId,
                notificationId: result.notificationId,
                receiveCount,
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
