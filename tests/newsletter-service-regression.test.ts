import { beforeEach, describe, expect, it, vi } from "vitest"

async function loadNewsletterService() {
    vi.resetModules()
    vi.unmock("@/service/newsletter-service")

    const createNewsletterBatchEntry = vi.fn()
    const createNewsletterEntry = vi.fn()
    const createNewsletterErrorEntry = vi.fn()
    const saveNewsletterNotification = vi.fn()
    const getNewsletterContent = vi.fn()
    const getNewsletterSentRecipients = vi.fn().mockResolvedValue(new Set())
    const getActiveSuppressedRecipients = vi.fn().mockResolvedValue(new Map())
    const sqsSend = vi.fn()
    const sesSend = vi.fn()

    vi.doMock("@/service/database/db", () => ({
        createNewsletterBatchEntry,
        createNewsletterEntry,
        createNewsletterErrorEntry,
        saveNewsletterNotification,
        checkNewsletterAlreadySent: vi.fn(),
        getNewsletterSentRecipients,
        getActiveSuppressedRecipients,
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
        createNewsletterErrorEntry,
        saveNewsletterNotification,
        getNewsletterContent,
        getNewsletterSentRecipients,
        getActiveSuppressedRecipients,
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
        vi.stubEnv("SES_BULK_SEND_ENABLED", "false")

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

    it("skips locally suppressed recipients and records a Mailgun-compatible failed event", async () => {
        vi.stubEnv("RATE_LIMIT", "1000000")
        vi.stubEnv("MAX_CONCURRENT", "5000")
        vi.stubEnv("SES_BULK_SEND_ENABLED", "false")

        const {
            service,
            createNewsletterEntry,
            saveNewsletterNotification,
            getNewsletterContent,
            getActiveSuppressedRecipients,
            sesSend,
        } = await loadNewsletterService()

        getNewsletterContent.mockResolvedValue({
            from: "newsletter@example.com",
            to: [
                "blocked@example.com",
                "reader@example.com",
            ],
            subject: "Weekly",
            html: "<p>Hello</p>",
            "v:email-id": "ghost-email-id",
        })
        getActiveSuppressedRecipients.mockResolvedValue(new Map([
            ["blocked@example.com", {
                email: "blocked@example.com",
                reason: "complained",
                source: "ses-complaint",
                failureCount: 0,
            }],
        ]))
        sesSend.mockResolvedValue({ MessageId: "ses-reader" })

        const result = await service.validateAndSend({
            Body: "newsletter-batch-db-id",
            ReceiptHandle: "receipt-handle",
            MessageAttributes: {
                siteId: { StringValue: "site-123", DataType: "String" },
                from: { StringValue: "newsletter@example.com", DataType: "String" },
            },
            Attributes: { ApproximateReceiveCount: "1" },
        } as any)

        expect(result).toBe("delete")
        expect(sesSend).toHaveBeenCalledTimes(1)
        expect(createNewsletterEntry).toHaveBeenCalledTimes(2)
        expect(createNewsletterEntry.mock.calls.map(call => call[2]).sort()).toEqual([
            "blocked@example.com",
            "reader@example.com",
        ])
        expect(saveNewsletterNotification).toHaveBeenCalledTimes(1)
        expect(saveNewsletterNotification.mock.calls[0][0]).toMatchObject({
            type: "failed",
        })
        expect(saveNewsletterNotification.mock.calls[0][0].messageId).toMatch(/^proxy-suppressed-/)
    })

    it("uses SES bulk sends for compatible newsletter batches while preserving per-recipient message ids", async () => {
        vi.stubEnv("RATE_LIMIT", "1000000")
        vi.stubEnv("MAX_CONCURRENT", "5000")
        vi.stubEnv("SES_BULK_SEND_ENABLED", "true")
        vi.stubEnv("SES_BULK_SEND_SIZE", "50")

        const {
            service,
            createNewsletterEntry,
            getNewsletterContent,
            sesSend,
        } = await loadNewsletterService()

        getNewsletterContent.mockResolvedValue({
            from: "newsletter@example.com",
            to: [
                "reader-1@example.com",
                "reader-2@example.com",
                "reader-3@example.com",
            ],
            subject: "Hello %recipient.name%",
            html: "<p>Hello %recipient.name%</p>",
            "h:List-Unsubscribe": "<%recipient.list_unsubscribe%>",
            "h:List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            "recipient-variables": {
                "reader-1@example.com": { name: "One", list_unsubscribe: "https://example.com/u/1" },
                "reader-2@example.com": { name: "Two", list_unsubscribe: "https://example.com/u/2" },
                "reader-3@example.com": { name: "Three", list_unsubscribe: "https://example.com/u/3" },
            },
            "v:email-id": "ghost-email-id",
        })
        sesSend.mockResolvedValue({
            BulkEmailEntryResults: [
                { Status: "SUCCESS", MessageId: "ses-bulk-1" },
                { Status: "SUCCESS", MessageId: "ses-bulk-2" },
                { Status: "SUCCESS", MessageId: "ses-bulk-3" },
            ],
        })

        await service.validateAndSend({
            Body: "newsletter-batch-db-id",
            ReceiptHandle: "receipt-handle",
            MessageAttributes: {
                siteId: { StringValue: "site-123", DataType: "String" },
                from: { StringValue: "newsletter@example.com", DataType: "String" },
            },
            Attributes: { ApproximateReceiveCount: "1" },
        } as any)

        expect(sesSend).toHaveBeenCalledTimes(1)
        expect(createNewsletterEntry).toHaveBeenCalledTimes(3)
        expect(createNewsletterEntry.mock.calls.map(call => call[0])).toEqual([
            "ses-bulk-1",
            "ses-bulk-2",
            "ses-bulk-3",
        ])
    })

    it.each([
        "ses:SendBulkEmail",
        "ses:SendBulkTemplatedEmail",
    ])("falls back to individual SES sends when %s is not allowed", async (deniedAction) => {
        vi.stubEnv("RATE_LIMIT", "1000000")
        vi.stubEnv("MAX_CONCURRENT", "5000")
        vi.stubEnv("SES_BULK_SEND_ENABLED", "true")
        vi.stubEnv("SES_BULK_SEND_SIZE", "50")

        const {
            service,
            createNewsletterEntry,
            createNewsletterErrorEntry,
            getNewsletterContent,
            sesSend,
        } = await loadNewsletterService()

        getNewsletterContent.mockResolvedValue({
            from: "newsletter@example.com",
            to: [
                "reader-1@example.com",
                "reader-2@example.com",
            ],
            subject: "Hello",
            html: "<p>Hello</p>",
            "v:email-id": "ghost-email-id",
        })

        let callNumber = 0
        sesSend.mockImplementation(async () => {
            callNumber++
            if (callNumber === 1) {
                const error = new Error(`User is not authorized to perform \`${deniedAction}\``)
                ;(error as Error & { name: string }).name = "AccessDeniedException"
                throw error
            }

            return { MessageId: `ses-single-${callNumber - 1}` }
        })

        const result = await service.validateAndSend({
            Body: "newsletter-batch-db-id",
            ReceiptHandle: "receipt-handle",
            MessageAttributes: {
                siteId: { StringValue: "site-123", DataType: "String" },
                from: { StringValue: "newsletter@example.com", DataType: "String" },
            },
            Attributes: { ApproximateReceiveCount: "1" },
        } as any)

        expect(result).toBe("delete")
        expect(sesSend).toHaveBeenCalledTimes(3)
        expect(createNewsletterEntry).toHaveBeenCalledTimes(2)
        expect(createNewsletterEntry.mock.calls.map(call => call[0])).toEqual([
            "ses-single-1",
            "ses-single-2",
        ])
        expect(createNewsletterErrorEntry).not.toHaveBeenCalled()
    })

    it("records send failures against the internal newsletter batch id", async () => {
        vi.stubEnv("RATE_LIMIT", "1000000")
        vi.stubEnv("MAX_CONCURRENT", "5000")
        vi.stubEnv("SES_BULK_SEND_ENABLED", "false")

        const {
            service,
            createNewsletterErrorEntry,
            getNewsletterContent,
            sesSend,
        } = await loadNewsletterService()

        getNewsletterContent.mockResolvedValue({
            from: "newsletter@example.com",
            to: ["reader@example.com"],
            subject: "Hello",
            html: "<p>Hello</p>",
            "v:email-id": "ghost-email-id",
        })
        sesSend.mockRejectedValue(new Error("SES rejected the message"))

        const result = await service.validateAndSend({
            Body: "newsletter-batch-db-id",
            ReceiptHandle: "receipt-handle",
            MessageAttributes: {
                siteId: { StringValue: "site-123", DataType: "String" },
                from: { StringValue: "newsletter@example.com", DataType: "String" },
            },
            Attributes: { ApproximateReceiveCount: "1" },
        } as any)

        expect(result).toBe("retry")
        expect(createNewsletterErrorEntry).toHaveBeenCalledTimes(1)
        expect(createNewsletterErrorEntry.mock.calls[0][2]).toBe("newsletter-batch-db-id")
        expect(createNewsletterErrorEntry.mock.calls[0][3]).toBe("reader@example.com")
    })
})
