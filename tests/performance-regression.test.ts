import { describe, expect, it, vi } from "vitest"

describe("Performance regressions", () => {
    it("prepares 5000-recipient Ghost newsletter batches without quadratic slowdown", async () => {
        vi.resetModules()
        vi.stubEnv("NEWSLETTER_CONFIGURATION_SET_NAME", "newsletter-config-set")
        const { preparePayload } = await import("@/lib/core/aws-utils")

        const recipients = Array.from({ length: 5000 }, (_, i) => `reader-${i}@example.com`)
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

        expect(payloads).toHaveLength(5000)
        expect(payloads[4999].request.Content?.Simple?.Subject?.Data).toBe("Hello Reader 4999")
        expect(durationMs).toBeLessThan(3000)
    })

    it("can stream 5000 prepared payloads without materializing a second array", async () => {
        vi.resetModules()
        vi.stubEnv("NEWSLETTER_CONFIGURATION_SET_NAME", "newsletter-config-set")
        const { preparePayloadIterator } = await import("@/lib/core/aws-utils")

        const recipients = Array.from({ length: 5000 }, (_, i) => `reader-${i}@example.com`)
        const started = performance.now()
        let count = 0
        let lastSubject = ""

        for (const payload of preparePayloadIterator({
            to: recipients,
            from: "Example <noreply@example.com>",
            subject: "Hello",
            html: "<p>Hello</p>",
            text: "Hello",
            "v:email-id": "ghost-email-id",
        }, "example.com")) {
            count++
            lastSubject = payload.request.Content?.Simple?.Subject?.Data || ""
        }

        const durationMs = performance.now() - started

        expect(count).toBe(5000)
        expect(lastSubject).toBe("Hello")
        expect(durationMs).toBeLessThan(1500)
    })

    it("can prepare SES bulk requests for 5000 recipients with 100 API calls", async () => {
        vi.resetModules()
        vi.stubEnv("NEWSLETTER_CONFIGURATION_SET_NAME", "newsletter-config-set")
        const { prepareBulkEmailRequest, preparePayloadIterator } = await import("@/lib/core/aws-utils")

        const recipients = Array.from({ length: 5000 }, (_, i) => `reader-${i}@example.com`)
        const recipientVariables = Object.fromEntries(
            recipients.map((email, i) => [email, {
                name: `Reader ${i}`,
                unsubscribe_url: `https://example.com/unsubscribe/${i}`,
            }])
        )
        const input = {
            to: recipients,
            from: "Example <noreply@example.com>",
            subject: "Hello %recipient.name%",
            html: "<p>%recipient.unsubscribe_url%</p>",
            text: "Hello %recipient.name%",
            "h:List-Unsubscribe": "<%recipient.unsubscribe_url%>",
            "recipient-variables": recipientVariables,
            "v:email-id": "ghost-email-id",
        }
        const started = performance.now()
        let apiCalls = 0
        let batch: any[] = []

        for (const payload of preparePayloadIterator(input, "example.com")) {
            batch.push(payload)
            if (batch.length === 50) {
                expect(prepareBulkEmailRequest(input, batch)?.BulkEmailEntries).toHaveLength(50)
                apiCalls++
                batch = []
            }
        }

        if (batch.length) {
            expect(prepareBulkEmailRequest(input, batch)?.BulkEmailEntries).toHaveLength(batch.length)
            apiCalls++
        }

        const durationMs = performance.now() - started

        expect(apiCalls).toBe(100)
        expect(durationMs).toBeLessThan(3000)
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

        const events = Array.from({ length: 5000 }, (_, i) => ({
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

        expect(result.items).toHaveLength(5000)
        expect(result.items[0].event).toBe("clicked")
        expect(result.items[4999].recipient).toBe("reader-4999@example.com")
        expect(durationMs).toBeLessThan(3000)
    })
})
