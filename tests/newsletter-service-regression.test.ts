import { beforeEach, describe, expect, it, vi } from "vitest"

async function loadNewsletterService() {
    vi.resetModules()
    vi.unmock("@/service/newsletter-service")

    const createNewsletterBatchEntry = vi.fn()
    const sqsSend = vi.fn()

    vi.doMock("@/service/database/db", () => ({
        createNewsletterBatchEntry,
        createNewsletterEntry: vi.fn(),
        createNewsletterErrorEntry: vi.fn(),
        checkNewsletterAlreadySent: vi.fn(),
        getNewsletterContent: vi.fn(),
        shouldPersistNewsletterFormattedContents: vi.fn().mockReturnValue(false),
    }))

    vi.doMock("@/service/aws/awsHelper", () => ({
        QUEUE_URL: { NEWSLETTER: "https://sqs.example.com/newsletter" },
        sqsClient: () => ({ send: sqsSend }),
        sesNewsletterClient: () => ({ send: vi.fn() }),
    }))

    const service = await import("@/service/newsletter-service")
    return { service, createNewsletterBatchEntry, sqsSend }
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
})
