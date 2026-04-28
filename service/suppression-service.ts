import { classifyNotificationSuppression, NotificationEvent } from "@/lib/core/aws-utils"
import logger from "@/lib/core/logger"
import {
    getNewsletterMessageForSuppression,
    upsertRecipientSuppression,
} from "./database/db"

const log = logger.child({ service: "service:suppression-service" })
const DEFAULT_TRANSIENT_BOUNCE_THRESHOLD = 3

function getTransientBounceThreshold() {
    const parsed = Number(process.env.SUPPRESSION_TRANSIENT_BOUNCE_THRESHOLD)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TRANSIENT_BOUNCE_THRESHOLD
}

export async function applyNewsletterSuppression(event: NotificationEvent) {
    const decision = classifyNotificationSuppression(event)
    if (!decision) return

    const message = await getNewsletterMessageForSuppression(event.messageId)
    if (!message) return

    const threshold = getTransientBounceThreshold()
    const result = await upsertRecipientSuppression({
        siteId: message.newsletterBatch.siteId,
        email: message.toEmail,
        reason: decision.reason,
        source: decision.source,
        active: decision.shouldSuppress,
        incrementFailureCount: decision.incrementFailureCount,
        activateAtFailureCount: decision.incrementFailureCount ? threshold : undefined,
        lastEventType: event.type,
        lastMessageId: event.messageId,
        lastNewsletterBatchId: message.newsletterBatchId,
        metadata: decision.metadata,
    })

    if (result.active) {
        log.warn({
            siteId: message.newsletterBatch.siteId,
            email: message.toEmail,
            reason: result.reason,
            failureCount: result.failureCount,
        }, "recipient added to local suppression list")
    }
}
