import { describe, expect, it, vi } from "vitest"

describe("Performance regressions", () => {
    it("prepares large Ghost newsletter batches without quadratic slowdown", async () => {
        vi.resetModules()
        vi.stubEnv("NEWSLETTER_CONFIGURATION_SET_NAME", "newsletter-config-set")
        const { preparePayload } = await import("@/lib/core/aws-utils")

        const recipients = Array.from({ length: 1000 }, (_, i) => `reader-${i}@example.com`)
        const recipientVariables = Object.fromEntries(
            recipients.map((email, i) => [email, {
                name: `Reader ${i}`,
                list_unsubscribe: `https://example.com/unsubscribe/${i}`,
            }])
        )

        const started = performance.now()
        const payloads = preparePayload({
            to: recipients,
            from: "Example <noreply@example.com>",
            "h:List-Unsubscribe": "<%recipient.list_unsubscribe%>",
            "h:List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            subject: "Hello %recipient.name%",
            html: "<p>Hello %recipient.name%</p>",
            text: "Hello %recipient.name%",
            "recipient-variables": JSON.stringify(recipientVariables),
            "v:email-id": "ghost-email-id",
        }, "example.com")
        const durationMs = performance.now() - started

        expect(payloads).toHaveLength(1000)
        expect(payloads[999].request.Content?.Simple?.Subject?.Data).toBe("Hello Reader 999")
        expect(durationMs).toBeLessThan(2000)
    })

    it("formats large SES event pages fast enough for Ghost polling", async () => {
        vi.resetModules()
        const { formatAsMailgunEvent } = await import("@/lib/core/aws-utils")

        const rawEvent = JSON.stringify({
            Type: "Notification",
            Message: JSON.stringify({
                eventType: "Click",
                mail: { messageId: "ses-message-id", timestamp: "2025-06-15T10:30:00Z" },
                click: {
                    timestamp: "2025-06-15T12:15:00Z",
                    link: "https://example.com/post",
                    ipAddress: "203.0.113.10",
                    userAgent: "Example Mail Client",
                },
            }),
        })

        const events = Array.from({ length: 1000 }, (_, i) => ({
            id: `event-${i}`,
            type: "clicked",
            messageId: `ses-msg-${i}`,
            timestamp: new Date("2025-06-15T12:15:00Z"),
            created: new Date("2025-06-15T12:16:00Z"),
            rawEvent,
            newsletter: {
                toEmail: `reader-${i}@example.com`,
                newsletterBatch: { batchId: "ghost-email-id" },
            },
        } as any))

        const started = performance.now()
        const result = formatAsMailgunEvent(events, "https://proxy.example/v3/site/events?start=0")
        const durationMs = performance.now() - started

        expect(result.items).toHaveLength(1000)
        expect(result.items[0].event).toBe("clicked")
        expect(result.items[999].recipient).toBe("reader-999@example.com")
        expect(durationMs).toBeLessThan(2000)
    })
})
