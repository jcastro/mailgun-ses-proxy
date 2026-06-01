import { 
    Message, 
    ReceiveMessageCommand, 
    DeleteMessageBatchCommand,
    MessageSystemAttributeName,
} from "@aws-sdk/client-sqs"
import { sqsClient } from "@/service/aws/awsHelper"
import logger from "./logger"

const log = logger.child({ module: "sqs-worker" })

export type WorkerHandlerResult = "delete" | "retry" | void

interface WorkerConfig {
    name: string
    queueUrl: string
    visibilityTimeout?: number
    waitTimeSeconds?: number
    pollTimeoutSeconds?: number
    receiveBatchSize?: number
    messageAttributeNames?: string[]
    systemAttributeNames?: MessageSystemAttributeName[]
    maxPolls?: number
    handler: (message: Message) => Promise<WorkerHandlerResult>
}

function clampReceiveBatchSize(value: unknown) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 10
    return Math.min(10, Math.max(1, Math.floor(parsed)))
}

function getPositiveNumber(value: unknown, fallback: number) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function shouldDeleteMessage(result: WorkerHandlerResult) {
    return result !== "retry"
}

async function deleteMessages(queueUrl: string, messages: Message[]) {
    const entries = messages
        .filter((message) => message.ReceiptHandle)
        .map((message, index) => ({
            Id: String(index),
            ReceiptHandle: message.ReceiptHandle!,
        }))

    if (!entries.length) return

    const response = await sqsClient().send(new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: entries,
    }))

    if (response.Failed?.length) {
        log.error({ queueUrl, failed: response.Failed }, "Some SQS messages could not be deleted")
    }
}

/**
 * Starts a long-polling SQS worker.
 * Handles polling, error logging, and batched deletion upon successful processing.
 */
export async function startWorker(config: WorkerConfig) {
    const { 
        name, 
        queueUrl, 
        visibilityTimeout = 30, 
        waitTimeSeconds = 20, 
        pollTimeoutSeconds = getPositiveNumber(
            process.env.SQS_POLL_TIMEOUT_SECONDS,
            Math.max(waitTimeSeconds + 15, 30)
        ),
        receiveBatchSize = 10,
        messageAttributeNames = [],
        systemAttributeNames = [MessageSystemAttributeName.ApproximateReceiveCount],
        maxPolls = Number.POSITIVE_INFINITY,
        handler 
    } = config

    if (!queueUrl) {
        log.error({ name }, "Queue URL is missing, worker cannot start")
        return
    }

    log.info({ name, queueUrl }, `Starting SQS worker: ${name}`)

    const client = sqsClient()
    const input = {
        QueueUrl: queueUrl,
        ...(messageAttributeNames.length ? { MessageAttributeNames: messageAttributeNames } : {}),
        ...(systemAttributeNames.length ? { MessageSystemAttributeNames: systemAttributeNames } : {}),
        MaxNumberOfMessages: clampReceiveBatchSize(receiveBatchSize),
        VisibilityTimeout: visibilityTimeout,
        WaitTimeSeconds: waitTimeSeconds,
    }

    let pollCount = 0

    while (pollCount < maxPolls) {
        pollCount++
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), pollTimeoutSeconds * 1000)
        timeout.unref?.()

        try {
            const receiveCommand = new ReceiveMessageCommand(input)
            const { Messages } = await client.send(receiveCommand, {
                abortSignal: controller.signal,
            })
            
            if (!Messages || Messages.length === 0) continue

            const processedMessages: Message[] = []

            for (const message of Messages) {
                try {
                    const result = await handler(message)
                    if (shouldDeleteMessage(result)) processedMessages.push(message)
                } catch (error) {
                    // On error, we leave the message in the queue for retry 
                    // (unless it's a permanent failure, which the handler should handle internally)
                    log.error({ name, messageId: message.MessageId, error: String(error) }, "Error processing message")
                }
            }

            await deleteMessages(queueUrl, processedMessages)
        } catch (error) {
            const isAbortError = error instanceof Error && error.name === "AbortError"
            if (isAbortError) {
                log.warn({ name, pollTimeoutSeconds }, "SQS poll timed out, retrying")
            } else {
                log.error({ name, error }, "Error polling SQS")
            }
            // exponential backoff or simple delay on polling error
            await new Promise(resolve => setTimeout(resolve, 5000))
        } finally {
            clearTimeout(timeout)
        }
    }
}
