import { prisma } from "@/lib/database"
import { getSessionFromCookies } from "@/lib/dashboard/auth"
import logger from "@/lib/core/logger"
import { formatAsMailgunEvent } from "@/lib/core/aws-utils"
import { NextRequest } from "next/server"

const log = logger.child({ path: "dashboard/api/events" })
const SORT_FIELDS = new Set(["type", "notificationId", "messageId", "timestamp", "created"])

export async function GET(req: NextRequest) {
    try {
        const session = await getSessionFromCookies()
        if (!session) {
            return Response.json({ error: "Unauthorized" }, { status: 401 })
        }

        const searchParams = req.nextUrl.searchParams
        const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")))
        const type = searchParams.get("type") || ""
        const search = searchParams.get("search") || ""
        const requestedSortBy = searchParams.get("sortBy") || "timestamp"
        const sortBy = SORT_FIELDS.has(requestedSortBy) ? requestedSortBy : "timestamp"
        const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc"

        const where: Record<string, unknown> = {}
        if (type) {
            where.type = type
        }
        if (search) {
            where.OR = [
                { messageId: { contains: search } },
                { notificationId: { contains: search } },
            ]
        }

        const [total, events] = await Promise.all([
            prisma.newsletterNotifications.count({ where }),
            prisma.newsletterNotifications.findMany({
                where,
                orderBy: { [sortBy]: sortOrder },
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    type: true,
                    notificationId: true,
                    messageId: true,
                    rawEvent: true,
                    timestamp: true,
                    created: true,
                    newsletter: {
                        select: {
                            toEmail: true,
                            newsletterBatch: {
                                select: {
                                    batchId: true,
                                    siteId: true,
                                    fromEmail: true,
                                    contents: true,
                                },
                            },
                        },
                    },
                },
            }),
        ])

        // Get distinct event types for the filter dropdown
        const eventTypes = await prisma.newsletterNotifications.findMany({
            distinct: ["type"],
            select: { type: true },
        })

        const normalizedEvents = formatAsMailgunEvent(events as any, req.url).items

        return Response.json({
            data: events.map((e, index) => {
                const normalized = normalizedEvents[index]

                return {
                    id: e.id,
                    type: e.type,
                    notificationId: e.notificationId,
                    messageId: e.messageId,
                    providerMessageId: normalized?.message.headers["x-ses-message-id"],
                    toEmail: e.newsletter?.toEmail || "N/A",
                    recipientDomain: normalized?.["recipient-domain"],
                    subject: normalized?.message.headers.subject,
                    siteId: e.newsletter?.newsletterBatch?.siteId,
                    batchId: e.newsletter?.newsletterBatch?.batchId,
                    tags: normalized?.tags || [],
                    severity: normalized?.severity,
                    reason: normalized?.reason,
                    url: normalized?.url,
                    deliveryStatus: normalized?.["delivery-status"],
                    timestamp: e.timestamp,
                    created: e.created,
                }
            }),
            eventTypes: eventTypes.map((t) => t.type),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        })
    } catch (error) {
        log.error(error, "Events API error")
        return Response.json({ error: "Internal server error" }, { status: 500 })
    }
}
