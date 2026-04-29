import { afterEach, describe, expect, it, vi } from "vitest"
import { createEventProcessor } from "@/lib/core/event-processor"

function sesEvent(messageId = "ses-message-id", timestamp = new Date().toISOString()) {
    return JSON.stringify({
        eventType: "Delivery",
        mail: {
            messageId,
            timestamp,
        },
        delivery: {
            timestamp,
        },
    })
}

describe("SES event processor", () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it("retries quietly when an event arrives before the local message row exists", async () => {
        const lookupMessage = vi.fn(async () => null)
        const saveNotification = vi.fn()
        const handler = createEventProcessor({
            name: "newsletter-events",
            lookupMessage,
            saveNotification,
        })

        const result = await handler({
            MessageId: "notification-1",
            Body: sesEvent(),
            Attributes: {
                ApproximateReceiveCount: "1",
            },
        } as any)

        expect(result).toBe("retry")
        expect(lookupMessage).toHaveBeenCalledWith("ses-message-id")
        expect(saveNotification).not.toHaveBeenCalled()
    })

    it("deletes stale events after the retry budget is exhausted", async () => {
        const lookupMessage = vi.fn()
        const saveNotification = vi.fn()
        const handler = createEventProcessor({
            name: "newsletter-events",
            lookupMessage,
            saveNotification,
            maxRetries: 3,
        })

        const result = await handler({
            MessageId: "notification-2",
            Body: sesEvent(),
            Attributes: {
                ApproximateReceiveCount: "4",
            },
        } as any)

        expect(result).toBeUndefined()
        expect(lookupMessage).not.toHaveBeenCalled()
        expect(saveNotification).not.toHaveBeenCalled()
    })

    it("deletes orphaned events that are older than the retry window", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-04-28T08:10:00.000Z"))

        const lookupMessage = vi.fn(async () => null)
        const saveNotification = vi.fn()
        const handler = createEventProcessor({
            name: "newsletter-events",
            lookupMessage,
            saveNotification,
            missingParentRetrySeconds: 120,
        })

        const result = await handler({
            MessageId: "notification-stale",
            Body: sesEvent("stale-ses-message-id", "2026-04-28T08:00:00.000Z"),
            Attributes: {
                ApproximateReceiveCount: "1",
            },
        } as any)

        expect(result).toBeUndefined()
        expect(lookupMessage).toHaveBeenCalledWith("stale-ses-message-id")
        expect(saveNotification).not.toHaveBeenCalled()
    })

    it("saves events when the parent message exists", async () => {
        const lookupMessage = vi.fn(async () => ({ id: "local-message" }))
        const saveNotification = vi.fn()
        const handler = createEventProcessor({
            name: "newsletter-events",
            lookupMessage,
            saveNotification,
        })

        const result = await handler({
            MessageId: "notification-3",
            Body: sesEvent("<ses-message-id@example.com>"),
            Attributes: {
                ApproximateReceiveCount: "1",
            },
        } as any)

        expect(result).toBeUndefined()
        expect(lookupMessage).toHaveBeenCalledWith("ses-message-id")
        expect(saveNotification).toHaveBeenCalledWith(expect.objectContaining({
            notificationId: "notification-3",
            messageId: "ses-message-id",
            type: "delivered",
        }))
    })
})
