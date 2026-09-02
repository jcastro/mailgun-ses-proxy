import { describe, expect, it } from "vitest"
import { parseNotificationEvent } from "@/lib/core/aws-utils"

const event = { eventType: "Open", mail: { messageId: "ses-1" }, open: { timestamp: "2026-09-02T09:00:00Z" } }
const envelope = (id: string) => JSON.stringify({ Type: "Notification", MessageId: id, Message: JSON.stringify(event) })

describe("event identity", () => {
    it("uses the SNS id across different SQS deliveries", () => {
        expect(parseNotificationEvent("sqs-1", envelope("sns-1")).notificationId)
            .toBe(parseNotificationEvent("sqs-2", envelope("sns-1")).notificationId)
    })
    it("preserves repeated opens, even with the same SES id and timestamp", () => {
        expect(parseNotificationEvent("sqs-1", envelope("sns-1")).notificationId)
            .not.toBe(parseNotificationEvent("sqs-2", envelope("sns-2")).notificationId)
    })
    it("retains SQS identity for raw event delivery", () => {
        expect(parseNotificationEvent("sqs-1", JSON.stringify(event)).notificationId).toBe("sqs-1")
    })
})
