import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const testUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!testUrl)("event and suppression transactions (real MySQL)", () => {
    let prisma: typeof import("@/lib/database").prisma
    let handle: typeof import("@/service/events-service").handleNewsletterEmailEvent
    const siteId = `test-${randomUUID()}`
    const messageId = randomUUID()
    const email = "reader@example.com"
    let batchId: string

    beforeAll(async () => {
        if (!testUrl || !new URL(testUrl).pathname.endsWith("_test")) throw new Error("A dedicated *_test database is required")
        vi.stubEnv("DATABASE_URL", testUrl)
        vi.resetModules()
        ;({ prisma } = await import("@/lib/database"))
        ;({ handleNewsletterEmailEvent: handle } = await import("@/service/events-service"))
        const batch = await prisma.newsletterBatch.create({ data: { siteId, batchId: "ghost-1", fromEmail: "test@example.com", contents: "{}" } })
        batchId = batch.id
        await prisma.newsletterMessages.create({ data: { messageId, newsletterBatchId: batchId, toEmail: email, formatedContents: "" } })
    })

    afterAll(async () => {
        if (!prisma) return
        await prisma.newsletterNotifications.deleteMany({ where: { messageId } })
        await prisma.suppressedRecipient.deleteMany({ where: { siteId } })
        await prisma.newsletterMessages.deleteMany({ where: { messageId } })
        if (batchId) await prisma.newsletterBatch.delete({ where: { id: batchId } })
        await prisma.$disconnect()
        vi.unstubAllEnvs()
    })

    beforeEach(async () => {
        await prisma.newsletterNotifications.deleteMany({ where: { messageId } })
        await prisma.suppressedRecipient.deleteMany({ where: { siteId } })
    })

    function notification(id: string, type: "Bounce" | "Complaint" = "Bounce") {
        return {
            MessageId: randomUUID(),
            Attributes: { ApproximateReceiveCount: "10" },
            Body: JSON.stringify({ Type: "Notification", MessageId: id, Message: JSON.stringify({
                eventType: type,
                mail: { messageId, timestamp: new Date().toISOString(), tags: { siteId: [siteId], batchId: ["ghost-1"] } },
                bounce: type === "Bounce" ? { bounceType: "Transient", bouncedRecipients: [{ emailAddress: email }] } : undefined,
                complaint: type === "Complaint" ? { complaintFeedbackType: "abuse" } : undefined,
            }) }),
        }
    }

    it("counts one bounce once despite two SQS deliveries", async () => {
        await handle(notification("transient-1"))
        await handle(notification("transient-1"))
        const row = await prisma.suppressedRecipient.findUniqueOrThrow({ where: { siteId_email: { siteId, email } } })
        expect(row.failureCount).toBe(1)
        expect(row.active).toBe(false)
        expect(await prisma.newsletterNotifications.count({ where: { messageId } })).toBe(1)
    })

    it("does not clear complaint suppression when a delayed transient bounce arrives", async () => {
        await handle(notification("complaint-1", "Complaint"))
        await handle(notification("transient-2"))
        const row = await prisma.suppressedRecipient.findUniqueOrThrow({ where: { siteId_email: { siteId, email } } })
        expect(row.active).toBe(true)
        expect(row.source).toBe("ses-complaint")
        expect(row.failureCount).toBe(1)
    })

    it("activates suppression only after three distinct transient bounces", async () => {
        for (const id of ["bounce-1", "bounce-2", "bounce-2", "bounce-3"]) await handle(notification(id))
        const row = await prisma.suppressedRecipient.findUniqueOrThrow({ where: { siteId_email: { siteId, email } } })
        expect(row.failureCount).toBe(3)
        expect(row.active).toBe(true)
        expect(row.reason).toBe("transient-bounce-threshold")
    })

    it("rolls back the event if suppression persistence fails", async () => {
        await prisma.newsletterMessages.update({ where: { messageId }, data: { toEmail: `${"x".repeat(400)}@example.com` } })
        try {
            await expect(handle(notification("rollback-1"))).rejects.toThrow()
            expect(await prisma.newsletterNotifications.count({ where: { messageId } })).toBe(0)
        } finally {
            await prisma.newsletterMessages.update({ where: { messageId }, data: { toEmail: email } })
        }
        await handle(notification("rollback-1"))
        expect(await prisma.newsletterNotifications.count({ where: { messageId } })).toBe(1)
    })
})
