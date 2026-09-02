import { createEventProcessor } from "@/lib/core/event-processor"
import { getNewsletterMessage, saveNewsletterNotification, prisma } from "../database/db"
import { applyNewsletterSuppression } from "../suppression-service"

function isGhostNewsletterEvent(event: Parameters<typeof saveNewsletterNotification>[0]) {
    return Boolean(event.tags.siteId?.length && event.tags.batchId?.length)
}

async function saveNewsletterNotificationWithSuppression(event: Parameters<typeof saveNewsletterNotification>[0]) {
    // Event insertion and suppression must commit together. A redelivery must not
    // increment the transient bounce counter again or lose a failed suppression.
    await prisma.$transaction(async (tx) => {
        const existing = await tx.newsletterNotifications.findUnique({
            where: { notificationId: event.notificationId },
            select: { id: true },
        })
        if (existing) return
        await tx.newsletterNotifications.create({ data: {
            messageId: event.messageId,
            rawEvent: event.raw,
            type: event.type,
            notificationId: event.notificationId,
            timestamp: event.timestamp,
        } })
        await applyNewsletterSuppression(event, tx)
    })
}

/**
 * Standardized handler for newsletter-related SES notification events.
 */
export const handleNewsletterEmailEvent = createEventProcessor({
    name: "newsletter-events",
    lookupMessage: getNewsletterMessage,
    saveNotification: saveNewsletterNotificationWithSuppression,
    shouldProcessEvent: isGhostNewsletterEvent,
})
