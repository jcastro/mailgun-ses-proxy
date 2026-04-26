import { ApiResponse } from "@/lib/api-response"
import logger from "@/lib/core/logger"

const log = logger.child({ path: "app:v3:suppressions" })
type PathParam = { params: Promise<{ siteId: string, type: string, email: string }> }

const VALID_TYPES = new Set(["bounces", "complaints", "unsubscribes"])

/**
 * Mailgun-compatible suppression removal endpoint.
 *
 * Ghost calls this after it has processed local suppression state. SES suppression
 * handling is managed via event publishing and Ghost's own suppression table, so
 * the proxy can acknowledge this idempotently.
 */
export async function DELETE(_req: Request, { params }: PathParam) {
    const { siteId, type, email } = await params

    if (!siteId) return ApiResponse.badRequest("siteId is required")
    if (!VALID_TYPES.has(type)) return ApiResponse.badRequest("suppression type is invalid")
    if (!email) return ApiResponse.badRequest("email is required")

    const decodedEmail = decodeURIComponent(email)
    log.info({ siteId, type, email: decodedEmail }, "suppression removal acknowledged")

    return ApiResponse.raw({
        message: "Suppression list item has been removed",
    }, 200)
}
