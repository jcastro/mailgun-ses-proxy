import { prisma } from "@/lib/database"
import { getSessionFromCookies } from "@/lib/dashboard/auth"
import logger from "@/lib/core/logger"
import { getMailgunMessageMetadata } from "@/lib/core/mailgun-metadata"
import { NextRequest } from "next/server"

const log = logger.child({ path: "dashboard/api/newsletters/[id]" })

type PathParam = { params: Promise<{ id: string }> }

function percentage(value: number, total: number) {
    if (total <= 0) return 0
    return Number(((value / total) * 100).toFixed(1))
}

export async function GET(req: NextRequest, { params }: PathParam) {
    try {
        const session = await getSessionFromCookies()
        if (!session) {
            return Response.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { id } = await params
        const searchParams = req.nextUrl.searchParams
        const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")))

        const batch = await prisma.newsletterBatch.findUnique({
            where: { id },
            select: {
                id: true,
                siteId: true,
                batchId: true,
                fromEmail: true,
                contents: true,
                created: true,
            },
        })

        if (!batch) {
            return Response.json({ error: "Batch not found" }, { status: 404 })
        }

        const [totalMessages, messages, totalErrors, errors, eventCounts] = await Promise.all([
            prisma.newsletterMessages.count({ where: { newsletterBatchId: id } }),
            prisma.newsletterMessages.findMany({
                where: { newsletterBatchId: id },
                orderBy: { created: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    messageId: true,
                    toEmail: true,
                    created: true,
                    notificationEvents: {
                        orderBy: { timestamp: "desc" },
                        take: 1,
                        select: {
                            type: true,
                            timestamp: true,
                        },
                    },
                    _count: {
                        select: { notificationEvents: true },
                    },
                },
            }),
            prisma.newsletterErrors.count({ where: { newsletterBatchId: id } }),
            prisma.newsletterErrors.findMany({
                where: { newsletterBatchId: id },
                orderBy: { created: "desc" },
                take: 50,
                select: {
                    id: true,
                    toEmail: true,
                    error: true,
                    created: true,
                    messageId: true,
                },
            }),
            prisma.newsletterNotifications.groupBy({
                by: ["type"],
                where: {
                    newsletter: { newsletterBatchId: id },
                },
                _count: { _all: true },
            }),
        ])
        const metadata = getMailgunMessageMetadata(batch.contents, batch.fromEmail)
        const eventsByType = Object.fromEntries(
            eventCounts.map((row) => [row.type, row._count._all])
        ) as Record<string, number>
        const totalDelivered = eventsByType.delivered || 0
        const totalOpened = eventsByType.opened || 0
        const totalClicked = eventsByType.clicked || 0
        const totalFailed = eventsByType.failed || 0
        const totalUnsubscribed = eventsByType.unsubscribed || 0
        const totalComplained = eventsByType.complained || 0

        return Response.json({
            batch: {
                id: batch.id,
                siteId: batch.siteId,
                batchId: batch.batchId,
                fromEmail: batch.fromEmail,
                created: batch.created,
                subject: metadata.subject,
                tags: metadata.tags,
                recipientCount: metadata.recipientCount,
                testMode: metadata.testMode,
                trackingOpens: metadata.trackingOpens,
                deliveryTime: metadata.deliveryTime,
            },
            metrics: {
                totalMessages,
                totalErrors,
                totalDelivered,
                totalOpened,
                totalClicked,
                totalFailed,
                totalUnsubscribed,
                totalComplained,
                deliveryRate: percentage(totalDelivered, totalMessages),
                openRate: percentage(totalOpened, totalDelivered || totalMessages),
                clickRate: percentage(totalClicked, totalDelivered || totalMessages),
                bounceRate: percentage(totalFailed, totalMessages),
                unsubscribeRate: percentage(totalUnsubscribed, totalDelivered || totalMessages),
                complaintRate: percentage(totalComplained, totalMessages),
            },
            messages: {
                data: messages.map((m) => ({
                    id: m.id,
                    messageId: m.messageId,
                    toEmail: m.toEmail,
                    created: m.created,
                    latestEvent: m.notificationEvents[0]?.type,
                    latestEventAt: m.notificationEvents[0]?.timestamp,
                    eventCount: m._count.notificationEvents,
                })),
                pagination: {
                    page,
                    limit,
                    total: totalMessages,
                    totalPages: Math.ceil(totalMessages / limit),
                },
            },
            errors: {
                data: errors,
                total: totalErrors,
            },
        })
    } catch (error) {
        log.error(error, "Newsletter detail API error")
        return Response.json({ error: "Internal server error" }, { status: 500 })
    }
}
