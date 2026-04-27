import { describe, expect, it, vi } from "vitest"

describe("SQS worker batching", () => {
    it("receives up to 10 messages and deletes successful messages in one batch", async () => {
        vi.resetModules()

        class ReceiveMessageCommand {
            constructor(public input: any) {}
        }

        class DeleteMessageBatchCommand {
            constructor(public input: any) {}
        }

        vi.doMock("@aws-sdk/client-sqs", () => ({
            ReceiveMessageCommand,
            DeleteMessageBatchCommand,
            MessageSystemAttributeName: {
                ApproximateReceiveCount: "ApproximateReceiveCount",
            },
        }))

        const sqsSend = vi.fn(async (command: any) => {
            if (command instanceof ReceiveMessageCommand) {
                return {
                    Messages: [
                        { MessageId: "m1", ReceiptHandle: "r1" },
                        { MessageId: "m2", ReceiptHandle: "r2" },
                        { MessageId: "m3", ReceiptHandle: "r3" },
                    ],
                }
            }

            return { Failed: [] }
        })

        vi.doMock("@/service/aws/awsHelper", () => ({
            sqsClient: () => ({ send: sqsSend }),
        }))

        const { startWorker } = await import("@/lib/core/sqs-worker")
        const handler = vi.fn(async (message: any) => message.MessageId === "m2" ? "retry" : undefined)

        await startWorker({
            name: "test-worker",
            queueUrl: "https://sqs.example.com/test",
            receiveBatchSize: 10,
            messageAttributeNames: ["siteId", "from"],
            maxPolls: 1,
            handler,
        })

        expect(handler).toHaveBeenCalledTimes(3)
        expect(sqsSend).toHaveBeenCalledTimes(2)

        const receiveInput = sqsSend.mock.calls[0][0].input
        expect(receiveInput.MaxNumberOfMessages).toBe(10)
        expect(receiveInput.MessageAttributeNames).toEqual(["siteId", "from"])
        expect(receiveInput.AttributeNames).toBeUndefined()

        const deleteInput = sqsSend.mock.calls[1][0].input
        expect(deleteInput.Entries).toEqual([
            { Id: "0", ReceiptHandle: "r1" },
            { Id: "1", ReceiptHandle: "r3" },
        ])
    })
})
