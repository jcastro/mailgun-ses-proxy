"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { 
    Search, 
    ArrowUpDown, 
    ArrowUp, 
    ArrowDown, 
    ChevronLeft, 
    ChevronRight,
    Activity,
    Loader2,
    Filter
} from "lucide-react"
import { 
    Card, 
    CardContent, 
    CardHeader, 
    CardTitle, 
    CardDescription 
} from "@/components/ui/card"
import { 
    Table, 
    TableBody, 
    TableCell, 
    TableHead, 
    TableHeader, 
    TableRow 
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn, formatRelativeTime } from "@/lib/utils"

interface EventItem {
    id: string
    type: string
    notificationId: string
    messageId: string
    providerMessageId?: string
    toEmail: string
    recipientDomain?: string
    subject?: string
    siteId?: string
    batchId?: string
    tags: string[]
    severity?: string
    reason?: string
    url?: string
    deliveryStatus?: {
        code: number
        message: string
        description?: string
        "enhanced-code"?: string | null
    }
    timestamp: string
    created: string
}

interface Pagination {
    page: number
    limit: number
    total: number
    totalPages: number
}

function EventsContent() {
    const searchParams = useSearchParams()
    const [data, setData] = useState<EventItem[]>([])
    const [eventTypes, setEventTypes] = useState<string[]>([])
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 })
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState(searchParams.get("search") || "")
    const [typeFilter, setTypeFilter] = useState("")
    const [sortBy, setSortBy] = useState("timestamp")
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")

    const fetchData = useCallback(async (page = 1) => {
        setLoading(true)
        try {
            const params = new URLSearchParams({
                page: String(page),
                limit: "20",
                sortBy,
                sortOrder,
                ...(search ? { search } : {}),
                ...(typeFilter ? { type: typeFilter } : {}),
            })
            const res = await fetch(`/dashboard/api/events?${params}`)
            const json = await res.json()
            setData(json.data || [])
            setEventTypes(json.eventTypes || [])
            setPagination(json.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 })
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }, [search, typeFilter, sortBy, sortOrder])

    useEffect(() => {
        fetchData(1)
    }, [fetchData])

    const handleSort = (column: string) => {
        if (sortBy === column) {
            setSortOrder(sortOrder === "asc" ? "desc" : "asc")
        } else {
            setSortBy(column)
            setSortOrder("desc")
        }
    }

    const SortIcon = ({ column }: { column: string }) => {
        if (sortBy !== column) return <ArrowUpDown className="ml-2 h-4 w-4 opacity-30" />
        return sortOrder === "asc" 
            ? <ArrowUp className="ml-2 h-4 w-4 text-primary" /> 
            : <ArrowDown className="ml-2 h-4 w-4 text-primary" />
    }

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        fetchData(1)
    }

    const getBadgeVariant = (type: string): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => {
        switch (type.toLowerCase()) {
            case "delivered":
            case "opened":
            case "clicked":
                return "success"
            case "failed":
            case "complained":
                return "destructive"
            case "unsubscribed":
                return "warning"
            default:
                return "secondary"
        }
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Events</h1>
                <p className="text-muted-foreground">Track email delivery notifications, bounces, and complaints</p>
            </div>

            <Card className="border-muted/50">
                <CardHeader className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
                    <div>
                        <CardTitle className="text-lg">Notification Events</CardTitle>
                        <CardDescription>Real-time delivery tracking across all providers</CardDescription>
                    </div>
                    <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
                        <div className="relative w-full md:w-40">
                            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <select
                                className="w-full bg-accent/50 border rounded-lg pl-10 pr-4 py-2 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value)}
                            >
                                <option value="">All Types</option>
                                {eventTypes.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </div>
                        <form onSubmit={handleSearch} className="relative w-full md:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                className="w-full bg-accent/50 border rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                placeholder="Search message ID..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </form>
                    </div>
                </CardHeader>

                <CardContent>
                    {loading ? (
                        <div className="flex flex-1 items-center justify-center min-h-[300px]">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : data.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center opacity-50">
                            <Activity className="h-10 w-10 mb-4" />
                            <p>{search || typeFilter ? "No events match your filters" : "No notification events found"}</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("type")}>
                                        <div className="flex items-center">Type <SortIcon column="type" /></div>
                                    </TableHead>
                                    <TableHead>Recipient</TableHead>
                                    <TableHead>Newsletter</TableHead>
                                    <TableHead>Details</TableHead>
                                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("messageId")}>
                                        <div className="flex items-center">Provider ID <SortIcon column="messageId" /></div>
                                    </TableHead>
                                    <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("timestamp")}>
                                        <div className="flex items-center justify-end">Timestamp <SortIcon column="timestamp" /></div>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.map((event) => (
                                    <TableRow key={event.id}>
                                        <TableCell>
                                            <Badge variant={getBadgeVariant(event.type)}>
                                                {event.type}
                                            </Badge>
                                            {event.severity ? (
                                                <div className="mt-1">
                                                    <Badge variant="outline">{event.severity}</Badge>
                                                </div>
                                            ) : null}
                                        </TableCell>
                                        <TableCell className="max-w-[220px]">
                                            <div className="truncate font-medium" title={event.toEmail}>
                                                {event.toEmail}
                                            </div>
                                            {event.recipientDomain ? (
                                                <div className="text-[10px] text-muted-foreground">{event.recipientDomain}</div>
                                            ) : null}
                                        </TableCell>
                                        <TableCell className="max-w-[240px]">
                                            <div className="truncate font-medium" title={event.subject || event.batchId || event.siteId}>
                                                {event.subject || event.batchId || event.siteId || "Newsletter"}
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                {event.tags.slice(0, 3).map((tag) => (
                                                    <Badge key={tag} variant="outline">{tag}</Badge>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className="max-w-[320px]">
                                            <div className="truncate text-xs" title={event.reason || event.deliveryStatus?.description || event.url || ""}>
                                                {event.reason || event.deliveryStatus?.message || event.url || "Recorded by SES"}
                                            </div>
                                            {event.deliveryStatus ? (
                                                <div className="text-[10px] text-muted-foreground">
                                                    SMTP {event.deliveryStatus.code}
                                                    {event.deliveryStatus["enhanced-code"] ? ` / ${event.deliveryStatus["enhanced-code"]}` : ""}
                                                </div>
                                            ) : event.url ? (
                                                <div className="truncate text-[10px] text-muted-foreground" title={event.url}>
                                                    {event.url}
                                                </div>
                                            ) : null}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground max-w-[150px] truncate" title={event.messageId}>
                                            {event.providerMessageId || event.messageId}
                                            <div className="text-[10px] text-muted-foreground truncate" title={event.notificationId}>
                                                {event.notificationId}
                                            </div>
                                        </TableCell>
                                        <TableCell 
                                            className="text-right text-xs text-muted-foreground whitespace-nowrap"
                                            title={new Date(event.timestamp).toLocaleString()}
                                        >
                                            {formatRelativeTime(event.timestamp)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}

                    {/* Pagination */}
                    {pagination.totalPages > 1 && (
                        <div className="mt-8 flex flex-col md:flex-row items-center justify-between gap-4 border-t pt-4">
                            <div className="text-xs text-muted-foreground">
                                Showing <span className="font-medium">{(pagination.page - 1) * pagination.limit + 1}</span> to <span className="font-medium">{Math.min(pagination.page * pagination.limit, pagination.total)}</span> of <span className="font-medium">{pagination.total}</span> events
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={pagination.page <= 1}
                                    onClick={() => fetchData(pagination.page - 1)}
                                >
                                    <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                                </Button>
                                <div className="flex items-center gap-1">
                                    {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                                        const start = Math.max(1, Math.min(pagination.page - 2, pagination.totalPages - 4))
                                        const pageNum = start + i
                                        if (pageNum > pagination.totalPages) return null
                                        return (
                                            <Button
                                                key={pageNum}
                                                variant={pageNum === pagination.page ? "default" : "ghost"}
                                                size="sm"
                                                className="h-8 w-8 p-0"
                                                onClick={() => fetchData(pageNum)}
                                            >
                                                {pageNum}
                                            </Button>
                                        )
                                    })}
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={pagination.page >= pagination.totalPages}
                                    onClick={() => fetchData(pagination.page + 1)}
                                >
                                    Next <ChevronRight className="h-4 w-4 ml-1" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

export default function EventsPage() {
    return (
        <Suspense fallback={
            <div className="flex flex-1 items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        }>
            <EventsContent />
        </Suspense>
    )
}
