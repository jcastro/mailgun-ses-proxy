"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn, formatRelativeTime } from "@/lib/utils"
import {
    AlertCircle,
    ArrowUpRight,
    CheckCircle2,
    Eye,
    Inbox,
    Loader2,
    Mail,
    MousePointerClick,
    Send,
    ShieldAlert,
    TrendingUp,
    UserMinus,
} from "lucide-react"
import { useEffect, useState } from "react"

interface StatsData {
    overview: {
        totalBatches: number
        totalMessages: number
        totalErrors: number
        totalAccepted: number
        totalDelivered: number
        totalOpened: number
        totalClicked: number
        totalBounced: number
        totalUnsubscribed: number
        totalComplaints: number
        deliveryRate: number
        openRate: number
        clickRate: number
        bounceRate: number
        complaintRate: number
        unsubscribeRate: number
        sendErrorRate: number
    }
    activity: {
        today: number
        thisWeek: number
        thisMonth: number
    }
    recentBatches: {
        id: string
        siteId: string
        batchId: string
        fromEmail: string
        subject?: string
        tags: string[]
        created: string
        messageCount: number
        errorCount: number
    }[]
}

export default function DashboardPage() {
    const [stats, setStats] = useState<StatsData | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetch("/dashboard/api/stats")
            .then((r) => r.json())
            .then((data) => setStats(data))
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [])

    if (loading) {
        return (
            <div className="flex flex-1 items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!stats) {
        return (
            <Card className="border-destructive/50 bg-destructive/5">
                <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                    <AlertCircle className="h-10 w-10 text-destructive mb-4" />
                    <CardTitle className="text-destructive">Failed to load dashboard stats</CardTitle>
                    <CardDescription>Please check your connection and try again.</CardDescription>
                    <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
                        Retry
                    </Button>
                </CardContent>
            </Card>
        )
    }

    const statCards = [
        {
            label: "Total Batches",
            value: stats.overview.totalBatches.toLocaleString(),
            icon: Inbox,
            color: "text-primary",
        },
        {
            label: "Messages Accepted",
            value: stats.overview.totalMessages.toLocaleString(),
            detail: `${stats.overview.totalAccepted.toLocaleString()} SES accepted events`,
            icon: Send,
            color: "text-primary",
        },
        {
            label: "Delivery Rate",
            value: `${stats.overview.deliveryRate}%`,
            detail: `${stats.overview.totalDelivered.toLocaleString()} delivered`,
            icon: CheckCircle2,
            color: "text-emerald-500",
        },
        {
            label: "Open Rate",
            value: `${stats.overview.openRate}%`,
            detail: `${stats.overview.totalOpened.toLocaleString()} opens`,
            icon: Eye,
            color: "text-sky-500",
        },
        {
            label: "Click Rate",
            value: `${stats.overview.clickRate}%`,
            detail: `${stats.overview.totalClicked.toLocaleString()} clicks`,
            icon: MousePointerClick,
            color: "text-violet-500",
        },
        {
            label: "Send Errors",
            value: stats.overview.totalErrors.toLocaleString(),
            detail: `${stats.overview.sendErrorRate}% of attempts`,
            icon: AlertCircle,
            color: "text-destructive",
        },
        {
            label: "Bounced",
            value: stats.overview.totalBounced.toLocaleString(),
            detail: `${stats.overview.bounceRate}% bounce rate`,
            icon: ShieldAlert,
            color: "text-orange-500",
        },
        {
            label: "Unsubscribed",
            value: stats.overview.totalUnsubscribed.toLocaleString(),
            detail: `${stats.overview.unsubscribeRate}% unsubscribe rate`,
            icon: UserMinus,
            color: "text-amber-500",
        },
        {
            label: "Complaints",
            value: stats.overview.totalComplaints.toLocaleString(),
            detail: `${stats.overview.complaintRate}% complaint rate`,
            icon: TrendingUp,
            color: "text-destructive",
        },
    ]

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>
                <p className="text-muted-foreground">Monitor your email sending infrastructure at a glance</p>
            </div>

            {/* Stat Cards */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {statCards.map((card) => {
                    const Icon = card.icon
                    return (
                        <Card key={card.label} className="transition-all hover:shadow-md border-muted/50">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                    {card.label}
                                </CardTitle>
                                <Icon className={cn("h-4 w-4", card.color)} />
                            </CardHeader>
                            <CardContent>
                                <div className={cn("text-2xl font-bold", card.color)}>{card.value}</div>
                                {"detail" in card && card.detail ? (
                                    <div className="mt-1 text-xs text-muted-foreground">{card.detail}</div>
                                ) : null}
                            </CardContent>
                        </Card>
                    )
                })}
            </div>

            {/* Activity Summary */}
            <Card className="border-muted/50">
                <CardHeader>
                    <CardTitle className="text-lg">Sending Activity</CardTitle>
                    <CardDescription>Daily, weekly and monthly distribution</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x border rounded-lg bg-card/50">
                    <div className="flex flex-col items-center justify-center py-6">
                        <div className="text-sm text-muted-foreground mb-1">Today</div>
                        <div className="text-3xl font-bold">{stats.activity.today.toLocaleString()}</div>
                        <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest font-bold">
                            messages
                        </div>
                    </div>
                    <div className="flex flex-col items-center justify-center py-6">
                        <div className="text-sm text-muted-foreground mb-1">This Week</div>
                        <div className="text-3xl font-bold">{stats.activity.thisWeek.toLocaleString()}</div>
                        <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest font-bold">
                            messages
                        </div>
                    </div>
                    <div className="flex flex-col items-center justify-center py-6">
                        <div className="text-sm text-muted-foreground mb-1">This Month</div>
                        <div className="text-3xl font-bold">{stats.activity.thisMonth.toLocaleString()}</div>
                        <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest font-bold">
                            messages
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Recent Batches */}
            <Card className="border-muted/50">
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-lg">Recent Newsletter Batches</CardTitle>
                        <CardDescription>Latest campaign activity from Ghost CMS</CardDescription>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => (window.location.href = "/dashboard/newsletters")}
                    >
                        View All <ArrowUpRight className="ml-2 h-3 w-3" />
                    </Button>
                </CardHeader>
                <CardContent>
                    {stats.recentBatches.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-center opacity-50">
                            <Mail className="h-10 w-10 mb-4" />
                            <p>No newsletter batches yet</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Newsletter</TableHead>
                                    <TableHead>Site</TableHead>
                                    <TableHead>From Email</TableHead>
                                    <TableHead>Tags</TableHead>
                                    <TableHead className="text-center">Messages</TableHead>
                                    <TableHead className="text-center">Errors</TableHead>
                                    <TableHead className="text-right">Created</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.recentBatches.map((batch) => (
                                    <TableRow key={batch.id}>
                                        <TableCell className="max-w-[260px]">
                                            <div className="truncate font-medium" title={batch.subject || batch.batchId}>
                                                {batch.subject || "Untitled newsletter"}
                                            </div>
                                            <div className="font-mono text-[10px] text-muted-foreground">
                                                {batch.batchId.slice(0, 16)}...
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-medium">{batch.siteId}</TableCell>
                                        <TableCell className="max-w-[200px] truncate">{batch.fromEmail}</TableCell>
                                        <TableCell className="max-w-[220px]">
                                            <div className="flex flex-wrap gap-1">
                                                {batch.tags.slice(0, 3).map((tag) => (
                                                    <Badge key={tag} variant="outline">{tag}</Badge>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant="secondary">{batch.messageCount}</Badge>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {batch.errorCount > 0 ? (
                                                <Badge variant="destructive">{batch.errorCount}</Badge>
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell
                                            className="text-right text-xs text-muted-foreground whitespace-nowrap"
                                            title={new Date(batch.created).toLocaleString()}
                                        >
                                            {formatRelativeTime(batch.created)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
