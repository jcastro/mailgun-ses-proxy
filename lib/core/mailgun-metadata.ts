export type StoredMailgunMessage = Record<string, unknown>

export const DEFAULT_MAILGUN_TAGS = ["bulk-email", "ghost-email"]

function isRecord(value: unknown): value is StoredMailgunMessage {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function asArray(value: unknown): string[] {
    if (!value) return []
    if (Array.isArray(value)) return value.map(String).filter(Boolean)
    return [String(value)].filter(Boolean)
}

function asAddressList(value: unknown): string[] {
    return asArray(value)
        .flatMap((item) => item.split(","))
        .map((item) => item.trim())
        .filter(Boolean)
}

function parseRecipientVariables(value: unknown): Record<string, unknown> {
    if (!value) return {}
    if (isRecord(value)) return value

    try {
        const parsed = JSON.parse(String(value))
        return isRecord(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function parseMailgunBoolean(value: unknown) {
    if (typeof value === "boolean") return value
    if (typeof value !== "string") return undefined

    const normalized = value.toLowerCase()
    if (["1", "true", "yes", "on"].includes(normalized)) return true
    if (["0", "false", "no", "off"].includes(normalized)) return false
    return undefined
}

function asMessage(input: StoredMailgunMessage | string | null | undefined): StoredMailgunMessage {
    if (typeof input === "string") return parseStoredMailgunMessage(input)
    return isRecord(input) ? input : {}
}

export function parseStoredMailgunMessage(value: string | null | undefined): StoredMailgunMessage {
    if (!value) return {}

    try {
        const parsed = JSON.parse(value)
        return isRecord(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

export function getMailgunTags(input: StoredMailgunMessage | string | null | undefined): string[] {
    const message = asMessage(input)
    const values = asArray(message["o:tag"])
        .flatMap((item) => item.split(","))
        .map((item) => item.trim())
        .filter(Boolean)

    return Array.from(new Set([...DEFAULT_MAILGUN_TAGS, ...values]))
}

export function getMailgunMessageMetadata(
    input: StoredMailgunMessage | string | null | undefined,
    fallbackFromEmail?: string | null
) {
    const message = asMessage(input)
    const recipients = asAddressList(message.to)
    const recipientVariables = parseRecipientVariables(message["recipient-variables"])

    return {
        subject: typeof message.subject === "string" ? message.subject : undefined,
        fromEmail: typeof message.from === "string" ? message.from : fallbackFromEmail || undefined,
        recipientCount: recipients.length || Object.keys(recipientVariables).length,
        tags: getMailgunTags(message),
        testMode: parseMailgunBoolean(message["o:testmode"]) || false,
        trackingOpens: parseMailgunBoolean(message["o:tracking-opens"]),
        deliveryTime: typeof message["o:deliverytime"] === "string" ? message["o:deliverytime"] : undefined,
    }
}
