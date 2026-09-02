import { prisma } from "@/lib/database"
import { verifyPassword, createSession, setSessionCookie, ensureDefaultUser } from "@/lib/dashboard/auth"
import { reserveLoginAttempt } from "@/lib/dashboard/login-limiter"
import logger from "@/lib/core/logger"

const log = logger.child({ path: "dashboard/api/login" })

export async function POST(req: Request) {
    let body: unknown
    try {
        body = await req.json()
    } catch {
        return Response.json({ error: "Invalid request" }, { status: 400 })
    }
    const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown }
    if (typeof email !== "string" || !email.trim() || email.length > 254
        || typeof password !== "string" || !password || password.length > 256) {
        return Response.json({ error: "Email and password are required" }, { status: 400 })
    }
    const retryAfter = reserveLoginAttempt(email)
    if (retryAfter) return Response.json({ error: "Too many login attempts" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } })
    try {
        if (!process.env.DASHBOARD_JWT_SECRET) throw new Error("Dashboard signing secret is not configured")
        await ensureDefaultUser()
        const user = await prisma.dashboardUser.findUnique({ where: { email: email.trim() } })
        // The legacy bootstrap identity must be recovered by the operator, never over HTTP.
        if (!user || user.email === "admin@localhost" || !await verifyPassword(password, user.password)) {
            return Response.json({ error: "Invalid credentials" }, { status: 401 })
        }
        const token = await createSession(user.id, user.email, user.name || "")
        const response = Response.json({
            ok: true,
            user: { id: user.id, email: user.email, name: user.name },
        })
        setSessionCookie(response, token)
        log.info({ userId: user.id }, "Successful dashboard login")
        return response
    } catch (error) {
        log.error(error, "Login error")
        return Response.json({ error: "Dashboard unavailable; check server configuration" }, { status: 503 })
    }
}
