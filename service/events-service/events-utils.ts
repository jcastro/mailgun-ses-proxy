import { EventsProps, QueryParams } from "@/types/default"
import { prisma } from "../database/db"
import { formatAsMailgunEvent } from "../../lib/core/aws-utils"

const DEFAULT_GHOST_TAGS = new Set(["bulk-email", "ghost-email"])

/**
 * Generates the "next" URL for Mailgun pagination.
 */
function getNextPageUrl(baseUrl: string, nextStart: number) {
    try {
        const url = new URL(baseUrl);
        url.searchParams.set("start", String(nextStart));
        url.searchParams.set("page", String(nextStart));
        return url.toString();
    } catch {
        return `${baseUrl}?start=${nextStart}`;
    }
}

function parseOffset(value: string | null) {
    if (!value) return 0
    const parsed = parseInt(value, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function parseUnixTimestamp(value: string | null, fallback: number) {
    if (!value) return fallback
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function parseLimit(value: string | null) {
    const parsed = parseInt(value || "300", 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return 300
    return Math.min(parsed, 1000)
}

function parseTagFilter(value: string | undefined) {
    if (!value) return []

    return value
        .split(/\s+AND\s+|\s*,\s*/i)
        .map((item) => item.trim())
        .filter(Boolean)
}

/**
 * Retrieves events from the database and formats them for Mailgun API compatibility.
 */
export async function getEmailEvents(params: EventsProps) {
    const skip = params.start || 0;
    const take = params.limit || 300;
    const requestedTags = parseTagFilter(params.tags)
    const customTags = requestedTags.filter((tag) => !DEFAULT_GHOST_TAGS.has(tag))

    // Handle Mailgun "OR" type filtering (e.g. "delivered OR opened")
    const types = params.type.match(/\s+OR\s+/i)
        ? params.type.split(/\s+OR\s+/i).map(s => s.trim().toLowerCase())
        : [params.type.toLowerCase()];

    const timeRange = {
        gt: new Date(params.begin * 1000), 
        lt: new Date(params.end * 1000) 
    };

    const result = await prisma.newsletterNotifications.findMany({
        skip,
        take,
        orderBy: { timestamp: params.order },
        include: { 
            newsletter: { 
                include: { newsletterBatch: true } 
            } 
        },
        where: {
            type: { in: types },
            newsletter: { 
                newsletterBatch: {
                    siteId: params.siteId,
                    ...(customTags.length ? {
                        AND: customTags.map((tag) => ({
                            contents: { contains: tag },
                        })),
                    } : {}),
                }
            },
            timestamp: timeRange,
        },
    });

    const nextUrl = getNextPageUrl(params.url, skip + take);
    return formatAsMailgunEvent(result, nextUrl);
}

/**
 * Validates and parses Mailgun query parameters.
 */
export function validateQueryParams(searchParams: URLSearchParams): QueryParams {
    const now = Math.floor(Date.now() / 1000);
    const event = searchParams.get("event") || "accepted OR delivered OR opened OR clicked OR failed OR unsubscribed OR complained";
    const ascending = String(searchParams.get("ascending") || "").toLowerCase();

    return {
        start: parseOffset(searchParams.get("page") || searchParams.get("start")),
        limit: parseLimit(searchParams.get("limit")),
        event,
        tags: searchParams.get("tags") || undefined,
        begin: parseUnixTimestamp(searchParams.get("begin"), 0),
        end: parseUnixTimestamp(searchParams.get("end"), now),
        order: ["1", "true", "yes"].includes(ascending) ? "asc" : "desc",
    };
}

/**
 * High-level wrapper for fetching analytics events.
 */
export async function fetchAnalyticsEvents(queryParams: QueryParams, siteId: string, url: string) {
    return getEmailEvents({
        siteId,
        type: queryParams.event,
        tags: queryParams.tags,
        begin: queryParams.begin,
        end: queryParams.end,
        order: queryParams.order,
        limit: queryParams.limit,
        start: queryParams.start,
        url,
    });
}
