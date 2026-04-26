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
    severity?: string
    reason?: string
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
        "enhanced-code": string | null
    }
    message: {
        headers: {
            "message-id": string
            "to"?: string
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
    begin: number
    end: number
    order: "asc" | "desc"
}
