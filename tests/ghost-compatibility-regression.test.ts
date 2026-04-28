import { describe, expect, it, vi, beforeEach } from "vitest"

describe("Ghost/Mailgun payload compatibility regressions", () => {
    beforeEach(() => {
        vi.resetModules()
        vi.stubEnv("NEWSLETTER_CONFIGURATION_SET_NAME", "newsletter-config-set")
    })

    it("creates one SES request per comma-separated Mailgun recipient", async () => {
        const { preparePayload } = await import("@/lib/core/aws-utils")

        const payloads = preparePayload({
            to: "reader-one@example.com, reader-two@example.com",
            from: "Example <noreply@example.com>",
            subject: "Hello",
            html: "<p>Hello</p>",
            text: "Hello",
            "v:email-id": "ghost-email-id",
        }, "example.com")

        expect(payloads).toHaveLength(2)
        expect(payloads[0].request.Destination?.ToAddresses).toEqual(["reader-one@example.com"])
        expect(payloads[1].request.Destination?.ToAddresses).toEqual(["reader-two@example.com"])
    })

    it("splits Reply-To lists while keeping unsafe address headers out of SES custom headers", async () => {
        const { preparePayload } = await import("@/lib/core/aws-utils")

        const payloads = preparePayload({
            to: ["reader@example.com"],
            from: "Example <noreply@example.com>",
            "h:Reply-To": "reply-one@example.com, reply-two@example.com",
            "h:To": "other@example.com",
            "h:Cc": "copy@example.com",
            subject: "Hello",
            html: "<p>Hello</p>",
            text: "Hello",
            "v:email-id": "ghost-email-id",
        }, "example.com")

        const request = payloads[0].request
        const headers = request.Content?.Simple?.Headers || []

        expect(request.ReplyToAddresses).toEqual(["reply-one@example.com", "reply-two@example.com"])
        expect(request.Destination?.CcAddresses).toEqual(["copy@example.com"])
        expect(headers).not.toContainEqual(expect.objectContaining({ Name: "To" }))
        expect(headers).not.toContainEqual(expect.objectContaining({ Name: "Cc" }))
        expect(headers).not.toContainEqual(expect.objectContaining({ Name: "Reply-To" }))
    })

    it("strips CRLF from Mailgun custom headers before handing them to SES", async () => {
        const { preparePayload } = await import("@/lib/core/aws-utils")

        const payloads = preparePayload({
            to: ["reader@example.com"],
            from: "Example <noreply@example.com>",
            "h:X-Ghost-Test": "safe\r\nBcc: injected@example.com",
            "h:Bad Header": "should be skipped",
            subject: "Hello",
            html: "<p>Hello</p>",
            text: "Hello",
            "v:email-id": "ghost-email-id",
        }, "example.com")

        const headers = payloads[0].request.Content?.Simple?.Headers || []

        expect(headers).toContainEqual({
            Name: "X-Ghost-Test",
            Value: "safe Bcc: injected@example.com",
        })
        expect(headers).not.toContainEqual(expect.objectContaining({ Name: "Bad Header" }))
    })

    it("builds SES bulk requests with Mailgun recipient variables and per-recipient headers", async () => {
        const { preparePayload, prepareBulkEmailRequest } = await import("@/lib/core/aws-utils")
        const input = {
            to: ["reader-one@example.com", "reader-two@example.com"],
            from: "Example <noreply@example.com>",
            subject: "Hello %recipient.name%",
            html: "<p>%recipient.unsubscribe_url%</p>",
            text: "Hello %recipient.name%",
            "h:List-Unsubscribe": "<%recipient.unsubscribe_url%>",
            "h:List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            "recipient-variables": {
                "reader-one@example.com": { name: "One", unsubscribe_url: "https://example.com/u/1" },
                "reader-two@example.com": { name: "Two", unsubscribe_url: "https://example.com/u/2" },
            },
            "v:email-id": "ghost-email-id",
        }

        const payloads = preparePayload(input, "example.com")
        const request = prepareBulkEmailRequest(input, payloads)

        expect(request?.DefaultContent.Template?.TemplateContent).toMatchObject({
            Subject: "Hello {{name}}",
            Html: "<p>{{unsubscribe_url}}</p>",
            Text: "Hello {{name}}",
        })
        expect(request?.BulkEmailEntries).toHaveLength(2)
        expect(request?.BulkEmailEntries?.[0].ReplacementEmailContent?.ReplacementTemplate?.ReplacementTemplateData).toBe(JSON.stringify({
            name: "One",
            unsubscribe_url: "https://example.com/u/1",
        }))
        expect(request?.BulkEmailEntries?.[1].ReplacementHeaders).toContainEqual({
            Name: "List-Unsubscribe",
            Value: "<https://example.com/u/2>",
        })
    })

    it("does not build SES bulk requests for unsafe inline template syntax", async () => {
        const { canPrepareBulkPayload, prepareBulkEmailRequest, preparePayload } = await import("@/lib/core/aws-utils")
        const input = {
            to: ["reader@example.com"],
            from: "Example <noreply@example.com>",
            subject: "Hello {{existing_template}}",
            html: "<p>Hello</p>",
            text: "Hello",
            "v:email-id": "ghost-email-id",
        }

        expect(canPrepareBulkPayload(input)).toBe(false)
        expect(prepareBulkEmailRequest(input, preparePayload(input, "example.com"))).toBeNull()
    })

    it("classifies complaints and permanent bounces for local suppression", async () => {
        const { classifyNotificationSuppression, parseNotificationEvent } = await import("@/lib/core/aws-utils")

        const complaint = parseNotificationEvent("notif-complaint", JSON.stringify({
            eventType: "Complaint",
            mail: { messageId: "ses-msg-complaint", timestamp: "2025-06-15T10:30:00Z" },
            complaint: { complaintFeedbackType: "abuse" },
        }))
        const bounce = parseNotificationEvent("notif-bounce", JSON.stringify({
            eventType: "Bounce",
            mail: { messageId: "ses-msg-bounce", timestamp: "2025-06-15T10:30:00Z" },
            bounce: {
                bounceType: "Permanent",
                bounceSubType: "General",
                bouncedRecipients: [{ status: "5.1.1" }],
            },
        }))

        expect(classifyNotificationSuppression(complaint)).toMatchObject({
            shouldSuppress: true,
            incrementFailureCount: false,
            source: "ses-complaint",
            reason: "abuse",
        })
        expect(classifyNotificationSuppression(bounce)).toMatchObject({
            shouldSuppress: true,
            incrementFailureCount: false,
            source: "ses-permanent-bounce",
            reason: "General",
        })
    })

    it("counts transient bounces without suppressing until the threshold is reached", async () => {
        const { classifyNotificationSuppression, parseNotificationEvent } = await import("@/lib/core/aws-utils")

        const event = parseNotificationEvent("notif-transient", JSON.stringify({
            eventType: "Bounce",
            mail: { messageId: "ses-msg-transient", timestamp: "2025-06-15T10:30:00Z" },
            bounce: {
                bounceType: "Transient",
                bouncedRecipients: [{ status: "4.4.7" }],
            },
        }))

        expect(classifyNotificationSuppression(event)).toMatchObject({
            shouldSuppress: false,
            incrementFailureCount: true,
            source: "ses-transient-bounce",
            reason: "transient-bounce",
        })
    })
})

describe("Mailgun event API regressions", () => {
    it("does not fail the whole events response if an old raw SES event is malformed", async () => {
        const { formatAsMailgunEvent } = await import("@/lib/core/aws-utils")

        const result = formatAsMailgunEvent([{
            id: "event-id",
            type: "opened",
            messageId: "ses-msg-open",
            timestamp: new Date("2025-06-15T12:15:00Z"),
            created: new Date("2025-06-15T12:16:00Z"),
            rawEvent: "not-json",
            newsletter: {
                toEmail: "reader@example.com",
                newsletterBatch: { batchId: "ghost-email-id" },
            },
        } as any], "https://proxy.example/v3/site/events?start=0")

        expect(result.items).toHaveLength(1)
        expect(result.items[0].event).toBe("opened")
        expect(result.items[0].recipient).toBe("reader@example.com")
        expect(result.items[0]["user-variables"]?.["email-id"]).toBe("ghost-email-id")
    })

    it("formats SES notifications with the Mailgun fields Ghost analytics expects", async () => {
        const { formatAsMailgunEvent } = await import("@/lib/core/aws-utils")

        const result = formatAsMailgunEvent([{
            id: "event-id",
            type: "failed",
            messageId: "ses-msg-bounce",
            timestamp: new Date("2025-06-15T12:15:00Z"),
            created: new Date("2025-06-15T12:16:00Z"),
            rawEvent: JSON.stringify({
                Type: "Notification",
                Message: JSON.stringify({
                    eventType: "Bounce",
                    mail: {
                        messageId: "ses-msg-bounce",
                        timestamp: "2025-06-15T10:30:00Z",
                        tags: {
                            siteId: ["example.com"],
                            batchId: ["ghost-email-id"],
                            "ghost-email": ["true"],
                            "mailgun-tag": ["ses-side-tag"],
                        },
                    },
                    bounce: {
                        timestamp: "2025-06-15T12:15:00Z",
                        bounceType: "Permanent",
                        bounceSubType: "General",
                        bouncedRecipients: [{
                            emailAddress: "reader@example.com",
                            status: "5.1.1",
                            diagnosticCode: "smtp; 550 5.1.1 user unknown",
                        }],
                    },
                }),
            }),
            newsletter: {
                toEmail: "reader@example.com",
                newsletterBatch: {
                    batchId: "ghost-email-id",
                    fromEmail: "Example <noreply@example.com>",
                    contents: JSON.stringify({
                        from: "Example <noreply@example.com>",
                        subject: "Important update",
                        "o:tag": ["member-news", "launch"],
                        "o:testmode": "true",
                    }),
                },
            },
        } as any], "https://proxy.example/v3/site/events?start=0")

        const item = result.items[0]
        expect(item).toMatchObject({
            event: "failed",
            severity: "permanent",
            recipient: "reader@example.com",
            "recipient-domain": "example.com",
            "log-level": "error",
            "user-variables": { "email-id": "ghost-email-id" },
            message: {
                headers: {
                    "message-id": "ghost-email-id",
                    "x-ses-message-id": "ses-msg-bounce",
                    "subject": "Important update",
                },
            },
            flags: {
                "is-authenticated": true,
                "is-test-mode": true,
            },
        })
        expect(item.tags).toEqual(expect.arrayContaining([
            "bulk-email",
            "ghost-email",
            "member-news",
            "launch",
            "ses-side-tag",
        ]))
        expect(item.tags).not.toContain("true")
        expect(item.tags).not.toContain("example.com")
        expect(item["delivery-status"]).toMatchObject({
            code: 550,
            description: "smtp; 550 5.1.1 user unknown",
            "enhanced-code": "5.1.1",
        })
    })

    it("defaults to all Ghost-relevant Mailgun event types, including accepted and clicked", async () => {
        const { validateQueryParams } = await import("@/service/events-service/events-utils")

        const result = validateQueryParams(new URLSearchParams())

        expect(result.event).toContain("accepted")
        expect(result.event).toContain("delivered")
        expect(result.event).toContain("opened")
        expect(result.event).toContain("clicked")
        expect(result.event).toContain("failed")
        expect(result.event).toContain("unsubscribed")
        expect(result.event).toContain("complained")
    })

    it("normalizes unsafe pagination values instead of trusting them", async () => {
        const { validateQueryParams } = await import("@/service/events-service/events-utils")

        const result = validateQueryParams(new URLSearchParams({
            page: "-50",
            limit: "999999",
        }))

        expect(result.start).toBe(0)
        expect(result.limit).toBe(1000)
    })
})

describe("API authentication regressions", () => {
    beforeEach(() => {
        vi.resetModules()
        vi.stubEnv("API_KEY", "expected-key")
    })

    it("accepts the Mailgun-style Basic auth used by Ghost", async () => {
        const { authentication } = await import("@/lib/authentication")
        const token = Buffer.from("api:expected-key").toString("base64")

        await expect(authentication(`Basic ${token}`)).resolves.toBe(true)
    })

    it("rejects bearer tokens even if they contain the right secret", async () => {
        const { authentication } = await import("@/lib/authentication")
        const token = Buffer.from("api:expected-key").toString("base64")

        await expect(authentication(`Bearer ${token}`)).resolves.toBe(false)
    })

    it("rejects every request when API_KEY is missing", async () => {
        vi.stubEnv("API_KEY", "")
        const { authentication } = await import("@/lib/authentication")
        const token = Buffer.from("api:expected-key").toString("base64")

        await expect(authentication(`Basic ${token}`)).resolves.toBe(false)
    })
})
