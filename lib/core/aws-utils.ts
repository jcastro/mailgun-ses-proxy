import { MailgunEvents, MailgunRecipientVariables } from "@/types/default"
import { MessageHeader, SendEmailRequest } from "@aws-sdk/client-sesv2"
import { Prisma } from "../generated"
import { replaceAll } from "./common"

type RecipientVariables = Partial<MailgunRecipientVariables[string]>

const DEFAULT_NEWSLETTER_EVENT_TAGS = [
    { Name: "ghost-email", Value: "true" },
]

const HEADER_KEYS_TO_SKIP = new Set([
    "reply-to",
    "cc",
    "bcc",
    "from",
    "to",
    "subject",
    "sender",
])

function doSubstitution(inputText: string | undefined, substitutions: RecipientVariables = {}) {
    if (!inputText) return ""

    for (const key of Object.keys(substitutions)) {
        inputText = replaceAll(
            inputText,
            `%recipient.${key}%`,
            String(substitutions[key as keyof MailgunRecipientVariables[0]] ?? "")
        )
    }
    return inputText
}

function parseRecipientVariables(value: unknown): MailgunRecipientVariables {
    if (!value) return {} as MailgunRecipientVariables
    if (typeof value === "object") return value as MailgunRecipientVariables

    try {
        return JSON.parse(String(value)) as MailgunRecipientVariables
    } catch {
        return {} as MailgunRecipientVariables
    }
}

function asArray(value: unknown): string[] {
    if (!value) return []
    if (Array.isArray(value)) return value.map(String).filter(Boolean)
    return [String(value)].filter(Boolean)
}

function asAddressList(value: unknown): string[] | undefined {
    const addresses = asArray(value)
        .flatMap((item) => item.split(","))
        .map((item) => item.trim())
        .filter(Boolean)

    return addresses.length ? addresses : undefined
}

function cleanMailgunHeaderValue(value: string) {
    return value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part && part !== "<>" && part !== "<%tag_unsubscribe_email%>")
        .join(", ")
}

function buildMailgunHeaders(input: any, recipientVariables: RecipientVariables) {
    const headers = new Map<string, string>()
    const addHeader = (name: string, value: unknown) => {
        const cleanName = name.trim()
        if (!cleanName || HEADER_KEYS_TO_SKIP.has(cleanName.toLowerCase())) return

        const rendered = cleanMailgunHeaderValue(doSubstitution(String(value ?? ""), recipientVariables))
        if (!rendered) return
        headers.set(cleanName, rendered)
    }

    for (const [key, value] of Object.entries(input)) {
        if (!key.startsWith("h:")) continue
        addHeader(key.slice(2), value)
    }

    const unsubscribeTemplate = input["h:List-Unsubscribe"]
    const unsubscribeUrl = recipientVariables.list_unsubscribe || recipientVariables.unsubscribe_url
    if (unsubscribeTemplate) {
        addHeader("List-Unsubscribe", unsubscribeTemplate)
    } else if (unsubscribeUrl) {
        addHeader("List-Unsubscribe", `<${unsubscribeUrl}>`)
    }

    if (unsubscribeUrl || input["h:List-Unsubscribe-Post"]) {
        addHeader("List-Unsubscribe-Post", input["h:List-Unsubscribe-Post"] || "List-Unsubscribe=One-Click")
    }

    return Array.from(headers.entries()).map(([Name, Value]) => ({ Name, Value })) as MessageHeader[]
}

export interface PreparedEmail {
    request: SendEmailRequest
    recipientVariables: RecipientVariables
}

export function preparePayload(input: any, siteId: string): PreparedEmail[] {
    const recepientVariables = parseRecipientVariables(input["recipient-variables"])
    const receivers = asArray(input.to)
    const result = receivers.map((receiverEmail: string | number) => {
        const recipientEmail = String(receiverEmail)
        const recipientVariables = recepientVariables[recipientEmail] || {}
        const replyTo = input["h:Reply-To"] ? [input["h:Reply-To"]] : undefined
        const headers = buildMailgunHeaders(input, recipientVariables)
        const cc = asAddressList(input["h:Cc"])
        const bcc = asAddressList(input["h:Bcc"])
        const destination = {
            ToAddresses: [recipientEmail],
            ...(cc ? { CcAddresses: cc } : {}),
            ...(bcc ? { BccAddresses: bcc } : {}),
        }

        return {
            request: {
            ConfigurationSetName: process.env.NEWSLETTER_CONFIGURATION_SET_NAME,
            FromEmailAddress: input.from,
            Destination: destination,
            ...(replyTo ? { ReplyToAddresses: replyTo } : {}),
            Content: {
                Simple: {
                    Subject: {
                        Data: doSubstitution(input.subject, recipientVariables),
                    },
                    Body: {
                        Text: {
                            Data: doSubstitution(input.text, recipientVariables),
                        },
                        Html: {
                            Data: doSubstitution(input.html, recipientVariables),
                        },
                    },
                    ...(headers.length ? { Headers: headers } : {}),
                },
            },
            EmailTags: [
                {
                    Name: "siteId",
                    Value: siteId,
                },
                {
                    Name: "batchId",
                    Value: input["v:email-id"],
                },
                ...DEFAULT_NEWSLETTER_EVENT_TAGS,
            ],
        },
            recipientVariables,
        }
    })
    return result
}

const awsToMailgunType = {
    Reject: "Failed",
    Bounce: "Failed",
    // None: "Stored", <- not aws type
    Complaint: "Complained",
    Subscription: "Unsubscribed",
    Click: "Clicked",
    Open: "Opened",
    RenderingFailure: "Failed",
    DeliveryDelay: "Failed",
    Delivery: "Delivered",
    Send: "Accepted",
}

export interface NotificationEvent {
    notificationId: string
    type: string
    messageId: string
    timestamp: Date
    raw: any
}

type SESEventPayload = {
    eventType: keyof typeof awsToMailgunType
    mail: { messageId: string, timestamp?: string | Date }
    send?: { timestamp?: string | Date }
    reject?: { timestamp?: string | Date, reason?: string }
    bounce?: {
        timestamp?: string | Date
        bounceType?: string
        bounceSubType?: string
        bouncedRecipients?: Array<{ status?: string, diagnosticCode?: string, emailAddress?: string }>
    }
    complaint?: {
        timestamp?: string | Date
        complaintFeedbackType?: string
        complainedRecipients?: Array<{ emailAddress?: string }>
    }
    delivery?: { timestamp?: string | Date, smtpResponse?: string }
    deliveryDelay?: { timestamp?: string | Date, delayType?: string, delayedRecipients?: Array<{ status?: string }> }
    open?: { timestamp?: string | Date, ipAddress?: string, userAgent?: string }
    click?: { timestamp?: string | Date, ipAddress?: string, userAgent?: string, link?: string }
    failure?: { timestamp?: string | Date, errorMessage?: string }
    subscription?: { timestamp?: string | Date, unsubscribeAll?: boolean, topicName?: string }
}

function unwrapSnsEvent(inputEvent: string): SESEventPayload {
    let parsed = JSON.parse(inputEvent)

    if (parsed.Type === "Notification") {
        parsed = JSON.parse(parsed.Message)
    }

    return parsed as SESEventPayload
}

function normalizeEventTimestamp(value: string | Date | undefined, fallback = new Date()) {
    if (!value) return fallback
    if (value instanceof Date) return value

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

function getEventTimestamp(event: SESEventPayload) {
    return event.open?.timestamp
        || event.click?.timestamp
        || event.delivery?.timestamp
        || event.bounce?.timestamp
        || event.complaint?.timestamp
        || event.deliveryDelay?.timestamp
        || event.subscription?.timestamp
        || event.failure?.timestamp
        || event.send?.timestamp
        || event.mail.timestamp
}

export function parseNotificationEvent(messageId: string, inputEvent: string): NotificationEvent {
    const event = unwrapSnsEvent(inputEvent)
    const mailgunType = awsToMailgunType[event.eventType] || "unknown"

    return {
        notificationId: messageId,
        type: String(mailgunType).toLocaleLowerCase(),
        messageId: event.mail.messageId.replace(/^<|>$/g, "").split("@")[0],
        timestamp: normalizeEventTimestamp(getEventTimestamp(event), new Date()),
        raw: inputEvent,
    }
}

type MailgunEventPayload = Prisma.NewsletterNotificationsGetPayload<{
    include: { newsletter: { include: { newsletterBatch: true } } }
}>

export function formatAsMailgunEvent(event: MailgunEventPayload[], url: string) {
    const format = (event: MailgunEventPayload) => {
        const eventTimestamp = (event.timestamp || event.created).getTime()
        const originalSESEvent = unwrapSnsEvent(event.rawEvent)
        const emailId = event.newsletter.newsletterBatch.batchId
        const out = {
            event: event.type,
            id: `${event.id}-${event.messageId}`,
            timestamp: Math.floor(eventTimestamp / 1000),
            recipient: event.newsletter.toEmail,
            "user-variables": {
                "email-id": emailId,
            },
            message: {
                headers: {
                    "message-id": emailId,
                    "to": event.newsletter.toEmail
                },
            },
        } as MailgunEvents

        if (originalSESEvent.eventType == "Bounce") {
            const isTransientBounce = originalSESEvent.bounce?.bounceType === "Transient"
            out["severity"] = isTransientBounce ? "temporary" : "permanent"
            out["reason"] = isTransientBounce ? "temporary-bounce" : "suppress-bounce"
            out["delivery-status"] = {
                code: isTransientBounce ? 400 : 605,
                message: originalSESEvent.bounce?.bounceType || (isTransientBounce ? "Temporary bounce" : "Permanent bounce"),
                "enhanced-code": originalSESEvent.bounce?.bouncedRecipients?.[0]?.status || null,
            }
        }

        if (originalSESEvent.eventType == "DeliveryDelay") {
            out["severity"] = "temporary"
            out["reason"] = originalSESEvent.deliveryDelay?.delayType || "delivery-delay"
            out["delivery-status"] = {
                code: 400,
                message: originalSESEvent.deliveryDelay?.delayType || "Delivery delayed",
                "enhanced-code": originalSESEvent.deliveryDelay?.delayedRecipients?.[0]?.status || null,
            }
        }

        if (originalSESEvent.eventType == "Reject" || originalSESEvent.eventType == "RenderingFailure") {
            out["severity"] = "permanent"
            out["reason"] = originalSESEvent.reject?.reason || originalSESEvent.failure?.errorMessage || "rejected"
            out["delivery-status"] = {
                code: 550,
                message: originalSESEvent.reject?.reason || originalSESEvent.failure?.errorMessage || "Rejected",
                "enhanced-code": null,
            }
        }

        if (originalSESEvent.eventType == "Complaint") {
            out["severity"] = "permanent"
            out["reason"] = originalSESEvent.complaint?.complaintFeedbackType || "complained"
        }

        if (originalSESEvent.eventType == "Click" && originalSESEvent.click?.link) {
            out["url"] = originalSESEvent.click.link
        }

        if (originalSESEvent.eventType == "Open" && (originalSESEvent.open?.ipAddress || originalSESEvent.open?.userAgent)) {
            out["client-info"] = {
                "client-ip": originalSESEvent.open?.ipAddress,
                "user-agent": originalSESEvent.open?.userAgent,
            }
        }

        if (originalSESEvent.eventType == "Click" && (originalSESEvent.click?.ipAddress || originalSESEvent.click?.userAgent)) {
            out["client-info"] = {
                "client-ip": originalSESEvent.click?.ipAddress,
                "user-agent": originalSESEvent.click?.userAgent,
            }
        }

        return out
    }

    const nextPage = (() => {
        try {
            const nextUrl = new URL(url)
            return nextUrl.searchParams.get("page") || nextUrl.searchParams.get("start") || "0"
        } catch {
            return "0"
        }
    })()

    return {
        items: event.map(format),
        paging: { next: url },
        pages: { next: { page: nextPage } },
    }
}
