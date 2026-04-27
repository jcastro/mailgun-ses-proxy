export interface MailgunRecipientVariables {
    [key: string]: {
        uuid: string
        unsubscribe_url: string
        list_unsubscribe: string
        [key: string]: any
    }
}

export interface EventsQueryParams {
    start: string
    limit: string
    event: string
    tags: string
    begin: number
    end: number
    ascending: boolean
}

export interface MailgunEvents {
    event: string
    id: string
    timestamp: number
    recipient: string
    url?: string
    tags?: string[]
    campaigns?: string[]
    "log-level"?: string
    "recipient-domain"?: string
    severity?: string
    reason?: string
    envelope?: {
        sender?: string
        transport?: string
        targets?: string
    }
    flags?: {
        "is-routed"?: boolean
        "is-authenticated"?: boolean
        "is-system-test"?: boolean
        "is-test-mode"?: boolean
    }
    "client-info"?: {
        "client-ip"?: string
        "user-agent"?: string
    }
    "user-variables"?: {
        "email-id": string
    }
    "delivery-status"?: {
        code: number
        message: string
        description?: string
        "enhanced-code": string | null
        "attempt-no"?: number
        "retry-seconds"?: number
        "mx-host"?: string
        "session-seconds"?: number
    }
    message: {
        size?: number
        attachments?: any[]
        headers: {
            "message-id": string
            "to"?: string
            "from"?: string
            "subject"?: string
            "x-ses-message-id"?: string
        }
    }
}

export interface AuthPayload {
    limit: {
        newsletter: number
        startDate: Date
        endDate: Date
    }
}

export interface EventsProps {
    siteId: string
    type: string
    tags?: string
    begin: number
    end: number
    order: "asc" | "desc"
    start: number
    limit: number
    url: string
}

export interface QueryParams {
    start: number
    limit: number
    event: string
    tags?: string
    begin: number
    end: number
    order: "asc" | "desc"
}
