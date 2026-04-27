import { TaskQueue } from "@/lib/task-queue"
import { MailgunMessage } from "@/types/mailgun"
import { SendBulkEmailCommand, SendEmailCommand } from "@aws-sdk/client-sesv2"
import { Message, SendMessageCommand } from "@aws-sdk/client-sqs"
import { randomUUID } from "node:crypto"
import {
    canPrepareBulkPayload,
    PreparedEmail,
    prepareBulkEmailRequest,
    preparePayloadIterator,
} from "../lib/core/aws-utils"
import { safeStringify } from "../lib/core/common"
import logger from "../lib/core/logger"
import { QUEUE_URL, sesNewsletterClient, sqsClient } from "./aws/awsHelper"
import {
    createNewsletterBatchEntry,
    createNewsletterEntry,
    createNewsletterErrorEntry,
    getNewsletterSentRecipients,
    getNewsletterContent,
    shouldPersistNewsletterFormattedContents,
} from "./database/db"

const log = logger.child({ service: "service:newsletter-service" })
const PERSIST_FORMATTED_CONTENTS = shouldPersistNewsletterFormattedContents()
const MAX_RECEIVE_COUNT = 3
const DEFAULT_RATE_LIMIT = 20
const DEFAULT_MAX_CONCURRENT = 100
const DEFAULT_BULK_SEND_SIZE = 50

function getPositiveNumber(value: unknown, fallback: number) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getBoolean(value: unknown, fallback: boolean) {
    if (value === undefined || value === null || value === "") return fallback
    const normalized = String(value).trim().toLowerCase()
    if (["1", "true", "yes", "on"].includes(normalized)) return true
    if (["0", "false", "no", "off"].includes(normalized)) return false
    return fallback
}

function getBulkSendSize(value: unknown) {
    const parsed = Math.floor(Number(value))
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BULK_SEND_SIZE
    return Math.min(50, parsed)
}

function normalizeRecipientList(value: unknown) {
    const values = Array.isArray(value) ? value : [value]
    return values
        .flatMap((item) => String(item || "").split(","))
        .map((item) => item.trim())
        .filter(Boolean)
}

export function validateNewsletterMessage(message: MailgunMessage) {
    if (!message || typeof message !== "object") throw new Error("Message body is empty or invalid.")
    if (!String(message.from || "").trim()) throw new Error("from is required")
    if (!normalizeRecipientList(message.to).length) throw new Error("to is required")
    if (!String(message.subject || "").trim()) throw new Error("subject is required")
    if (!String(message.html || "").trim() && !String(message.text || "").trim()) {
        throw new Error("html or text content is required")
    }
}

function getPreparedToEmail(prepared: PreparedEmail) {
    return prepared.request.Destination?.ToAddresses?.join() || ""
}

function getPreparedRecipientData(prepared: PreparedEmail) {
    const toEmail = getPreparedToEmail(prepared)
    return {
        toEmail,
        recipientData: JSON.stringify({ toEmail, variables: prepared.recipientVariables }),
        formattedContents: PERSIST_FORMATTED_CONTENTS ? safeStringify(prepared.request) : "",
    }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Saves a newsletter batch to the DB and enqueues it to SQS for background processing.
 */
export async function addNewsletterToQueue(message: MailgunMessage, siteId: string) {
    validateNewsletterMessage(message)

    const { id } = await createNewsletterBatchEntry(siteId, message)
    const response = await sqsClient().send(new SendMessageCommand({
        QueueUrl: QUEUE_URL.NEWSLETTER,
        MessageBody: String(id),
        MessageAttributes: {
            siteId: { DataType: "String", StringValue: siteId },
            from: { DataType: "String", StringValue: message.from },
        },
    }))

    log.info({ batchId: message["v:email-id"], messageId: response.MessageId }, "newsletter queued to SQS")
    return { batchId: message["v:email-id"], messageId: response.MessageId }
}

/**
 * Processes a single SQS message: validates, sends all emails, handles retries.
 *
 * Retry strategy:
 *  - On success → message is deleted from SQS
 *  - On partial failure → message stays in SQS for re-delivery;
 *    already-sent recipients are skipped via idempotency check
 *  - After MAX_RECEIVE_COUNT retries → message is deleted to prevent infinite loops
 */
export async function validateAndSend(message: Message) {
    const batchId = message.Body
    const siteId = message.MessageAttributes?.["siteId"]?.StringValue
    const from = message.MessageAttributes?.["from"]?.StringValue

    if (!batchId || !siteId || !from) {
        log.error({ message: safeStringify(message) }, "invalid or incomplete SQS message, discarding")
        return "delete" as const
    }

    const receiveCount = parseInt(message.Attributes?.ApproximateReceiveCount || "0")
    if (receiveCount > MAX_RECEIVE_COUNT) {
        log.error({ batchId, receiveCount }, "batch exceeded max retries, discarding")
        return "delete" as const
    }

    try {
        await processBatch(siteId, batchId)
        return "delete" as const
    } catch (e) {
        // Leave the message in SQS — it will be re-delivered after the visibility timeout.
        // On retry, already-sent recipients are skipped via the idempotency check.
        log.error({ err: e, batchId, receiveCount }, "batch processing failed, will retry")
        return "retry" as const
    }
}

// ─── Internal: Batch Processing ──────────────────────────────

/**
 * Loads a newsletter batch from the DB and sends all emails via a rate-limited concurrent queue.
 * Throws if any recipients fail, so the SQS message is kept for retry.
 */
async function processBatch(siteId: string, newsletterBatchId: string) {
    const contents = await getNewsletterContent(newsletterBatchId)
    if (!contents) {
        throw new Error(`Newsletter batch not found: ${newsletterBatchId}`)
    }

    const emailBatchId = contents["v:email-id"]
    const alreadyQueuedOrSent = await getNewsletterSentRecipients(newsletterBatchId)
    const rateLimit = getPositiveNumber(process.env.RATE_LIMIT, DEFAULT_RATE_LIMIT)
    const maxConcurrent = getPositiveNumber(process.env.MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT)
    const bulkEnabled = getBoolean(process.env.SES_BULK_SEND_ENABLED, true) && canPrepareBulkPayload(contents)
    const bulkSendSize = bulkEnabled ? getBulkSendSize(process.env.SES_BULK_SEND_SIZE) : 1
    const queue = new TaskQueue({ rateLimit, maxConcurrent })

    let queuedCount = 0
    let skippedCount = 0
    let emailCount = 0
    let pendingBulkBatch: PreparedEmail[] = []

    const enqueuePreparedBatch = (batch: PreparedEmail[]) => {
        if (!batch.length) return

        const batchToSend = batch.slice()
        queuedCount += batchToSend.length
        void queue.enqueue(
            () => sendPreparedBatch(contents, batchToSend, newsletterBatchId, siteId, emailBatchId, bulkEnabled),
            emailBatchId,
            batchToSend.length
        ).catch(() => undefined)
    }

    for (const prepared of preparePayloadIterator(contents, siteId)) {
        emailCount++
        const toEmail = getPreparedToEmail(prepared)
        if (!toEmail || alreadyQueuedOrSent.has(toEmail)) {
            skippedCount++
            continue
        }

        alreadyQueuedOrSent.add(toEmail)

        if (bulkSendSize > 1) {
            pendingBulkBatch.push(prepared)
            if (pendingBulkBatch.length >= bulkSendSize) {
                enqueuePreparedBatch(pendingBulkBatch)
                pendingBulkBatch = []
            }
        } else {
            enqueuePreparedBatch([prepared])
        }
    }

    enqueuePreparedBatch(pendingBulkBatch)

    log.info({
        emailCount,
        queuedCount,
        skippedCount,
        bulkEnabled,
        bulkSendSize,
        emailBatchId
    }, "processing newsletter batch")

    const results = await queue.waitUntilFinished()
    log.info({
        sent: results.settledCount - results.failedCount,
        failed: results.failedCount,
        skipped: skippedCount,
        durationMs: Math.round(results.totalDuration),
    }, "newsletter batch completed")

    if (results.failedCount > 0) {
        throw new Error(`${results.failedCount}/${queuedCount} emails failed in batch ${emailBatchId}`)
    }
}

// ─── Internal: SES Send Helpers ──────────────────────────────

async function sendPreparedBatch(
    contents: MailgunMessage,
    batch: PreparedEmail[],
    newsletterBatchId: string,
    siteId: string,
    emailBatchId: string,
    bulkEnabled: boolean
) {
    if (bulkEnabled && batch.length > 1) {
        try {
            await sendBulkEmailBatch(contents, batch, newsletterBatchId, siteId, emailBatchId)
            return
        } catch (error) {
            if (!isBulkSendPermissionError(error)) throw error

            log.warn({
                err: error,
                batchSize: batch.length,
                siteId,
                emailBatchId,
            }, "SES bulk send is not authorized, falling back to individual sends")
        }
    }

    for (const prepared of batch) {
        await sendSingleEmail(prepared, newsletterBatchId, siteId, emailBatchId)
    }
}

async function recordNewsletterSuccess(
    prepared: PreparedEmail,
    messageId: string,
    newsletterBatchId: string,
    siteId: string
) {
    const { toEmail, recipientData, formattedContents } = getPreparedRecipientData(prepared)
    await createNewsletterEntry(messageId, newsletterBatchId, toEmail, recipientData, formattedContents)
    log.info({ messageId, toEmail, siteId }, "email sent")
}

async function recordNewsletterFailure(
    prepared: PreparedEmail,
    error: unknown,
    newsletterBatchId: string,
    siteId: string
) {
    const errorId = randomUUID()
    const { toEmail, recipientData, formattedContents } = getPreparedRecipientData(prepared)
    log.error({ err: error, errorId, toEmail, siteId }, "SES send failed")
    await createNewsletterErrorEntry(errorId, String(error), newsletterBatchId, toEmail, recipientData, formattedContents)
}

function isBulkSendPermissionError(error: unknown) {
    const name = typeof error === "object" && error && "name" in error ? String(error.name) : ""
    const message = error instanceof Error ? error.message : String(error)
    return name === "AccessDeniedException"
        && (message.includes("SendBulkEmail") || message.includes("SendBulkTemplatedEmail"))
}

async function sendBulkEmailBatch(
    contents: MailgunMessage,
    batch: PreparedEmail[],
    newsletterBatchId: string,
    siteId: string,
    emailBatchId: string
) {
    const request = prepareBulkEmailRequest(contents, batch)
    if (!request) {
        throw new Error("Bulk SES request could not be prepared")
    }

    try {
        const response = await sesNewsletterClient().send(new SendBulkEmailCommand(request))
        const results = response.BulkEmailEntryResults || []
        let failedCount = 0

        for (let index = 0; index < batch.length; index++) {
            const prepared = batch[index]
            const result = results[index]

            if (result?.Status === "SUCCESS" && result.MessageId) {
                await recordNewsletterSuccess(prepared, result.MessageId, newsletterBatchId, siteId)
                continue
            }

            failedCount++
            await recordNewsletterFailure(
                prepared,
                result?.Error || result?.Status || "Unknown SES bulk send failure",
                newsletterBatchId,
                siteId
            )
        }

        if (failedCount > 0) {
            throw new Error(`${failedCount}/${batch.length} SES bulk recipients failed`)
        }
    } catch (error) {
        if (String(error).includes("SES bulk recipients failed")) throw error
        if (isBulkSendPermissionError(error)) throw error

        for (const prepared of batch) {
            await recordNewsletterFailure(prepared, error, newsletterBatchId, siteId)
        }
        throw error
    }
}

/**
 * Sends a single email via SES with idempotency protection.
 * - Checks if the recipient was already sent in this batch (prevents duplicates on retry)
 * - On success, records in `newsletterMessages`
 * - On failure, records in `newsletterErrors` and re-throws for the queue to track
 */
async function sendSingleEmail(
    prepared: PreparedEmail,
    newsletterBatchId: string,
    siteId: string,
    emailBatchId: string
) {
    const { request, recipientVariables } = prepared

    try {
        const resp = await sesNewsletterClient().send(new SendEmailCommand(request))
        const messageId = resp.MessageId as string
        await recordNewsletterSuccess({ request, recipientVariables }, messageId, newsletterBatchId, siteId)
    } catch (e) {
        await recordNewsletterFailure({ request, recipientVariables }, e, newsletterBatchId, siteId)
        throw e // Re-throw so the queue tracks this as a failure
    }
}
