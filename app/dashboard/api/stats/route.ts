import { prisma } from "@/lib/database"
import { getSessionFromCookies } from "@/lib/dashboard/auth"
import logger from "@/lib/core/logger"
import { getMailgunMessageMetadata } from "@/lib/core/mailgun-metadata"

const log = logger.child({ path: "dashboard/api/stats" })

function percentage(value: number, total: number) {
    if (total <= 0) return 0
    return Number(((value / total) * 100).toFixed(1))
}

export async function GET() {
    try {
        const session = await getSessionFromCookies()
        if (!session) {
            return Response.json({ error: "Unauthorized" }, { status: 401 })
        }

        const now = new Date()
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const startOfWeek = new Date(startOfToday)
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

        const [
            totalBatches,
            totalMessages,
            totalErrors,
            eventCounts,
            messagesToday,
            messagesThisWeek,
            messagesThisMonth,
            recentBatches,
        ] = await Promise.all([
            prisma.newsletterBatch.count(),
            prisma.newsletterMessages.count(),
            prisma.newsletterErrors.count(),
            prisma.newsletterNotifications.groupBy({
                by: ["type"],
                _count: { _all: true },
            }),
            prisma.newsletterMessages.count({ where: { created: { gte: startOfToday } } }),
            prisma.newsletterMessages.count({ where: { created: { gte: startOfWeek } } }),
            prisma.newsletterMessages.count({ where: { created: { gte: startOfMonth } } }),
            prisma.newsletterBatch.findMany({
                orderBy: { created: "desc" },
                take: 10,
                select: {
                    id: true,
                    siteId: true,
                    batchId: true,
                    fromEmail: true,
                    contents: true,
                    created: true,
                    _count: {
                        select: {
                            NewslettersMessages: true,
                            NewslettersErrors: true,
                        },
                    },
                },
            }),
        ])

        const eventsByType = Object.fromEntries(
            eventCounts.map((row) => [row.type, row._count._all])
        ) as Record<string, number>
        const totalAccepted = eventsByType.accepted || 0
        const totalDelivered = eventsByType.delivered || 0
        const totalOpened = eventsByType.opened || 0
        const totalClicked = eventsByType.clicked || 0
        const totalBounced = eventsByType.failed || 0
        const totalUnsubscribed = eventsByType.unsubscribed || 0
        const totalComplaints = eventsByType.complained || 0

        return Response.json({
            overview: {
                totalBatches,
                totalMessages,
                totalErrors,
                totalAccepted,
                totalDelivered,
                totalOpened,
                totalClicked,
                totalBounced,
                totalUnsubscribed,
                totalComplaints,
                deliveryRate: percentage(totalDelivered, totalMessages),
                openRate: percentage(totalOpened, totalDelivered || totalMessages),
                clickRate: percentage(totalClicked, totalDelivered || totalMessages),
                bounceRate: percentage(totalBounced, totalMessages),
                complaintRate: percentage(totalComplaints, totalMessages),
                unsubscribeRate: percentage(totalUnsubscribed, totalDelivered || totalMessages),
                sendErrorRate: percentage(totalErrors, totalMessages + totalErrors),
            },
            activity: {
                today: messagesToday,
                thisWeek: messagesThisWeek,
                thisMonth: messagesThisMonth,
            },
            recentBatches: recentBatches.map((b) => {
                const metadata = getMailgunMessageMetadata(b.contents, b.fromEmail)

                return {
                    id: b.id,
                    siteId: b.siteId,
                    batchId: b.batchId,
                    fromEmail: b.fromEmail,
                    subject: metadata.subject,
                    tags: metadata.tags,
                    created: b.created,
                    messageCount: b._count.NewslettersMessages,
                    errorCount: b._count.NewslettersErrors,
                }
            }),
        })
    } catch (error) {
        log.error(error, "Stats API error")
        return Response.json({ error: "Internal server error" }, { status: 500 })
    }
}
