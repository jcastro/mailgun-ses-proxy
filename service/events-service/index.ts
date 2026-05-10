import { createEventProcessor } from "@/lib/core/event-processor"
import { getNewsletterMessage, saveNewsletterNotification } from "../database/db"
import { applyNewsletterSuppression } from "../suppression-service"

function isGhostNewsletterEvent(event: Parameters<typeof saveNewsletterNotification>[0]) {
    return Boolean(event.tags.siteId?.length && event.tags.batchId?.length)
}

async function saveNewsletterNotificationWithSuppression(event: Parameters<typeof saveNewsletterNotification>[0]) {
    await saveNewsletterNotification(event)
    await applyNewsletterSuppression(event)
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
