import { MailgunEvents, MailgunRecipientVariables } from "@/types/default"
import { BulkEmailEntry, MessageHeader, SendBulkEmailRequest, SendEmailRequest } from "@aws-sdk/client-sesv2"
import { Prisma } from "../generated"
import { replaceAll } from "./common"

type RecipientVariables = Partial<MailgunRecipientVariables[string]>
type HeaderTemplate = { name: string, value: unknown }
type BulkTemplate = { subject: string, text?: string, html?: string, keys: string[] }

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

const RFC_5322_HEADER_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/
const SAFE_SES_TEMPLATE_KEY = /^[A-Za-z0-9_]+$/
const MAILGUN_RECIPIENT_TOKEN = /%recipient\.([^%]+)%/g
const SES_TEMPLATE_MARKERS = /{{|}}/

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
        .replace(/[\r\n]+[ \t]*/g, " ")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part && part !== "<>" && part !== "<%tag_unsubscribe_email%>")
        .join(", ")
}

function getMailgunHeaderTemplates(input: any): HeaderTemplate[] {
    return Object.entries(input)
        .filter(([key]) => key.startsWith("h:"))
        .map(([key, value]) => ({ name: key.slice(2), value }))
}

function buildMailgunHeaders(
    headerTemplates: HeaderTemplate[],
    recipientVariables: RecipientVariables,
    unsubscribeTemplate?: unknown,
    unsubscribePost?: unknown
) {
    const headers = new Map<string, string>()
    const addHeader = (name: string, value: unknown) => {
        const cleanName = name.trim()
        if (!cleanName || HEADER_KEYS_TO_SKIP.has(cleanName.toLowerCase())) return
        if (!RFC_5322_HEADER_NAME.test(cleanName)) return

        const rendered = cleanMailgunHeaderValue(doSubstitution(String(value ?? ""), recipientVariables))
        if (!rendered) return
        headers.set(cleanName, rendered)
    }

    for (const { name, value } of headerTemplates) {
        addHeader(name, value)
    }

    const unsubscribeUrl = recipientVariables.list_unsubscribe || recipientVariables.unsubscribe_url
    if (unsubscribeTemplate) {
        addHeader("List-Unsubscribe", unsubscribeTemplate)
    } else if (unsubscribeUrl) {
        addHeader("List-Unsubscribe", `<${unsubscribeUrl}>`)
    }

    if (unsubscribeUrl || unsubscribePost) {
        addHeader("List-Unsubscribe-Post", unsubscribePost || "List-Unsubscribe=One-Click")
    }

    return Array.from(headers.entries()).map(([Name, Value]) => ({ Name, Value })) as MessageHeader[]
}

function collectRecipientTemplateKeys(values: unknown[]) {
    const keys = new Set<string>()

    for (const value of values) {
        const raw = String(value ?? "")
        for (const match of raw.matchAll(MAILGUN_RECIPIENT_TOKEN)) {
            const key = match[1]
            if (!SAFE_SES_TEMPLATE_KEY.test(key)) return null
            keys.add(key)
        }
    }

    return Array.from(keys)
}

function toSESTemplate(value: unknown) {
    const raw = String(value ?? "")
    if (SES_TEMPLATE_MARKERS.test(raw)) return null

    return raw.replace(MAILGUN_RECIPIENT_TOKEN, (_, key) => `{{${key}}}`)
}

function buildBulkTemplate(input: any): BulkTemplate | null {
    const keys = collectRecipientTemplateKeys([input.subject, input.text, input.html])
    if (!keys) return null

    const subject = toSESTemplate(input.subject)
    const text = toSESTemplate(input.text)
    const html = toSESTemplate(input.html)
    if (subject === null || text === null || html === null) return null

    return {
        subject,
        ...(text ? { text } : {}),
        ...(html ? { html } : {}),
        keys,
    }
}

function buildReplacementTemplateData(keys: string[], recipientVariables: RecipientVariables) {
    const data: Record<string, string> = {}

    for (const key of keys) {
        const value = recipientVariables[key as keyof RecipientVariables]
        data[key] = value === undefined || value === null
            ? `%recipient.${key}%`
            : String(value)
    }

    return JSON.stringify(data)
}

export interface PreparedEmail {
    request: SendEmailRequest
    recipientVariables: RecipientVariables
}

export function* preparePayloadIterator(input: any, siteId: string): Generator<PreparedEmail> {
    const recepientVariables = parseRecipientVariables(input["recipient-variables"])
    const receivers = asAddressList(input.to) || []
    const replyTo = asAddressList(input["h:Reply-To"])
    const cc = asAddressList(input["h:Cc"])
    const bcc = asAddressList(input["h:Bcc"])
    const headerTemplates = getMailgunHeaderTemplates(input)
    const unsubscribeTemplate = input["h:List-Unsubscribe"]
    const unsubscribePost = input["h:List-Unsubscribe-Post"]

    for (const receiverEmail of receivers) {
        const recipientEmail = String(receiverEmail)
        const recipientVariables = recepientVariables[recipientEmail] || {}
        const headers = buildMailgunHeaders(headerTemplates, recipientVariables, unsubscribeTemplate, unsubscribePost)
        const destination = {
            ToAddresses: [recipientEmail],
            ...(cc ? { CcAddresses: cc } : {}),
            ...(bcc ? { BccAddresses: bcc } : {}),
        }

        yield {
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
    }
}

export function preparePayload(input: any, siteId: string): PreparedEmail[] {
    return Array.from(preparePayloadIterator(input, siteId))
}

export function canPrepareBulkPayload(input: any) {
    return buildBulkTemplate(input) !== null
}

export function prepareBulkEmailRequest(input: any, batch: PreparedEmail[]): SendBulkEmailRequest | null {
    if (!batch.length) return null

    const template = buildBulkTemplate(input)
    if (!template) return null

    const firstRequest = batch[0].request
    const entries: BulkEmailEntry[] = batch.map(({ request, recipientVariables }) => {
        const headers = request.Content?.Simple?.Headers || []

        return {
            Destination: request.Destination,
            ...(headers.length ? { ReplacementHeaders: headers } : {}),
            ...(template.keys.length ? {
                ReplacementEmailContent: {
                    ReplacementTemplate: {
                        ReplacementTemplateData: buildReplacementTemplateData(template.keys, recipientVariables),
                    },
                },
            } : {}),
        }
    })

    return {
        ConfigurationSetName: firstRequest.ConfigurationSetName,
        FromEmailAddress: firstRequest.FromEmailAddress,
        ...(firstRequest.ReplyToAddresses?.length ? { ReplyToAddresses: firstRequest.ReplyToAddresses } : {}),
        ...(firstRequest.EmailTags?.length ? { DefaultEmailTags: firstRequest.EmailTags } : {}),
        DefaultContent: {
            Template: {
                TemplateContent: {
                    Subject: template.subject,
                    ...(template.text ? { Text: template.text } : {}),
                    ...(template.html ? { Html: template.html } : {}),
                },
                TemplateData: "{}",
            },
        },
        BulkEmailEntries: entries,
    }
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

function tryUnwrapSnsEvent(inputEvent: string): SESEventPayload | null {
    try {
        return unwrapSnsEvent(inputEvent)
    } catch {
        return null
    }
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
        const originalSESEvent = tryUnwrapSnsEvent(event.rawEvent)
        const eventType = originalSESEvent?.eventType
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

        if (originalSESEvent && eventType == "Bounce") {
            const isTransientBounce = originalSESEvent.bounce?.bounceType === "Transient"
            out["severity"] = isTransientBounce ? "temporary" : "permanent"
            out["reason"] = isTransientBounce ? "temporary-bounce" : "suppress-bounce"
            out["delivery-status"] = {
                code: isTransientBounce ? 400 : 605,
                message: originalSESEvent.bounce?.bounceType || (isTransientBounce ? "Temporary bounce" : "Permanent bounce"),
                "enhanced-code": originalSESEvent.bounce?.bouncedRecipients?.[0]?.status || null,
            }
        }

        if (originalSESEvent && eventType == "DeliveryDelay") {
            out["severity"] = "temporary"
            out["reason"] = originalSESEvent.deliveryDelay?.delayType || "delivery-delay"
            out["delivery-status"] = {
                code: 400,
                message: originalSESEvent.deliveryDelay?.delayType || "Delivery delayed",
                "enhanced-code": originalSESEvent.deliveryDelay?.delayedRecipients?.[0]?.status || null,
            }
        }

        if (originalSESEvent && (eventType == "Reject" || eventType == "RenderingFailure")) {
            out["severity"] = "permanent"
            out["reason"] = originalSESEvent.reject?.reason || originalSESEvent.failure?.errorMessage || "rejected"
            out["delivery-status"] = {
                code: 550,
                message: originalSESEvent.reject?.reason || originalSESEvent.failure?.errorMessage || "Rejected",
                "enhanced-code": null,
            }
        }

        if (originalSESEvent && eventType == "Complaint") {
            out["severity"] = "permanent"
            out["reason"] = originalSESEvent.complaint?.complaintFeedbackType || "complained"
        }

        if (originalSESEvent && eventType == "Click" && originalSESEvent.click?.link) {
            out["url"] = originalSESEvent.click.link
        }

        if (originalSESEvent && eventType == "Open" && (originalSESEvent.open?.ipAddress || originalSESEvent.open?.userAgent)) {
            out["client-info"] = {
                "client-ip": originalSESEvent.open?.ipAddress,
                "user-agent": originalSESEvent.open?.userAgent,
            }
        }

        if (originalSESEvent && eventType == "Click" && (originalSESEvent.click?.ipAddress || originalSESEvent.click?.userAgent)) {
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
