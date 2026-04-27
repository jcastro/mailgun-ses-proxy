import { beforeEach, describe, expect, it, vi } from "vitest"

async function loadNewsletterService() {
    vi.resetModules()
    vi.unmock("@/service/newsletter-service")

    const createNewsletterBatchEntry = vi.fn()
    const createNewsletterEntry = vi.fn()
    const getNewsletterContent = vi.fn()
    const getNewsletterSentRecipients = vi.fn().mockResolvedValue(new Set())
    const sqsSend = vi.fn()
    const sesSend = vi.fn()

    vi.doMock("@/service/database/db", () => ({
        createNewsletterBatchEntry,
        createNewsletterEntry,
        createNewsletterErrorEntry: vi.fn(),
        checkNewsletterAlreadySent: vi.fn(),
        getNewsletterSentRecipients,
        getNewsletterContent,
        shouldPersistNewsletterFormattedContents: vi.fn().mockReturnValue(false),
    }))

    vi.doMock("@/service/aws/awsHelper", () => ({
        QUEUE_URL: { NEWSLETTER: "https://sqs.example.com/newsletter" },
        sqsClient: () => ({ send: sqsSend }),
        sesNewsletterClient: () => ({ send: sesSend }),
    }))

    const service = await import("@/service/newsletter-service")
    return {
        service,
        createNewsletterBatchEntry,
        createNewsletterEntry,
        getNewsletterContent,
        getNewsletterSentRecipients,
        sqsSend,
        sesSend,
    }
}

describe("Newsletter service regressions", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("validates Ghost/Mailgun newsletter messages before writing to the database or SQS", async () => {
        const { service, createNewsletterBatchEntry, sqsSend } = await loadNewsletterService()

        await expect(service.addNewsletterToQueue({
            from: "newsletter@example.com",
            to: "",
            subject: "Weekly",
            html: "<p>Hello</p>",
        } as any, "site-123")).rejects.toThrow("to is required")

        expect(createNewsletterBatchEntry).not.toHaveBeenCalled()
        expect(sqsSend).not.toHaveBeenCalled()
    })

    it("accepts comma-separated recipient lists from Mailgun-compatible payloads", async () => {
        const { service } = await loadNewsletterService()

        expect(() => service.validateNewsletterMessage({
            from: "newsletter@example.com",
            to: "one@example.com, two@example.com",
            subject: "Weekly",
            html: "<p>Hello</p>",
        })).not.toThrow()
    })

    it("requires either html or text content", async () => {
        const { service } = await loadNewsletterService()

        expect(() => service.validateNewsletterMessage({
            from: "newsletter@example.com",
            to: "reader@example.com",
            subject: "Weekly",
        } as any)).toThrow("html or text content is required")
    })

    it("loads sent recipients once per batch and skips already sent or duplicate recipients", async () => {
        vi.stubEnv("RATE_LIMIT", "1000000")
        vi.stubEnv("MAX_CONCURRENT", "5000")

        const {
            service,
            createNewsletterEntry,
            getNewsletterContent,
            getNewsletterSentRecipients,
            sesSend,
        } = await loadNewsletterService()

        getNewsletterContent.mockResolvedValue({
            from: "newsletter@example.com",
            to: [
                "sent@example.com",
                "new@example.com",
                "new@example.com",
                "other@example.com",
            ],
            subject: "Weekly",
            html: "<p>Hello</p>",
            "v:email-id": "ghost-email-id",
        })
        getNewsletterSentRecipients.mockResolvedValue(new Set(["sent@example.com"]))
        let messageNumber = 0
        sesSend.mockImplementation(async () => ({ MessageId: `ses-${++messageNumber}` }))

        await service.validateAndSend({
            Body: "newsletter-batch-db-id",
            ReceiptHandle: "receipt-handle",
            MessageAttributes: {
                siteId: { StringValue: "site-123", DataType: "String" },
                from: { StringValue: "newsletter@example.com", DataType: "String" },
            },
            Attributes: { ApproximateReceiveCount: "1" },
        } as any)

        expect(getNewsletterSentRecipients).toHaveBeenCalledTimes(1)
        expect(getNewsletterSentRecipients).toHaveBeenCalledWith("newsletter-batch-db-id")
        expect(sesSend).toHaveBeenCalledTimes(2)
        expect(createNewsletterEntry).toHaveBeenCalledTimes(2)
        expect(createNewsletterEntry.mock.calls.map(call => call[2]).sort()).toEqual([
            "new@example.com",
            "other@example.com",
        ])
    })
})
