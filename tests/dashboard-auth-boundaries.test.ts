import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { createHmac } from "node:crypto"
import { NextRequest } from "next/server"
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"

const db = vi.hoisted(() => ({
    count: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(),
}))
vi.mock("@/lib/database", () => ({ prisma: { dashboardUser: db } }))
vi.mock("next/headers", () => ({ cookies: vi.fn() }))

import { proxy, config } from "@/proxy"
import { createSession, verifySession } from "@/lib/dashboard/session"
import { hashPassword, verifyPassword, ensureDefaultUser, setSessionCookie } from "@/lib/dashboard/auth"

const secret = "test-only-session-signing-secret-with-spaces "
function signed(payload: unknown, encoding: BufferEncoding = "utf8") {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(JSON.stringify(payload), encoding).toString("base64url")
    return header + "." + body + "." + createHmac("sha256", secret).update(header + "." + body).digest("base64url")
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("DASHBOARD_JWT_SECRET", secret)
    vi.stubEnv("API_KEY", "test-only-api-key")
    vi.stubEnv("DASHBOARD_ADMIN_EMAIL", "")
    vi.stubEnv("DASHBOARD_ADMIN_PASSWORD", "")
    vi.stubEnv("DASHBOARD_RESET_LEGACY_ADMIN", "")
    db.count.mockResolvedValue(1)
    db.findUnique.mockResolvedValue(null)
})
afterEach(() => vi.unstubAllEnvs())

describe("authentication at the actual Next route matcher", () => {
    it.each([
        "/v3/site.json/messages", "/v3/site/events/cursor.json", "/v3/site/events/a.png",
        "/v3/site/events/a.js/more", "/v1/send", "/stats", "/dashboard/api/settings.json",
        "/v3/site%2Ejson/messages", "/dashboard/api/login-extra", "/healthcheck-extra",
    ])("requires authentication for %s", async path => {
        expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(true)
        const result = await proxy(new NextRequest("https://proxy.example" + path))
        expect(result.status).toBe(401)
    })

    it("preserves Mailgun Basic auth on site domains containing dots", async () => {
        const result = await proxy(new NextRequest("https://proxy.example/v3/example.com/messages", {
            headers: { authorization: "Basic " + Buffer.from("api:test-only-api-key").toString("base64") },
        }))
        expect(result.headers.get("x-middleware-next")).toBe("1")
    })

    it("excludes only framework assets and preserves public health/login paths", async () => {
        expect(unstable_doesMiddlewareMatch({ config, url: "/_next/static/chunk.js" })).toBe(false)
        for (const path of ["/healthcheck", "/dashboard/login", "/dashboard/api/login"]) {
            expect((await proxy(new NextRequest("https://proxy.example" + path))).status).toBe(200)
        }
    })

    it("rejects forged cookies but accepts valid existing signing bytes", async () => {
        const token = await createSession("user-id", "operator@example.com", "Operator")
        const forged = token.slice(0, token.lastIndexOf(".") + 1) + "fake"
        for (const [cookie, status] of [[forged, 401], [token, 200]] as const) {
            const response = await proxy(new NextRequest("https://proxy.example/dashboard/api/settings", {
                headers: { cookie: "dashboard_token=" + cookie },
            }))
            expect(response.status).toBe(status)
        }
    })
})

describe("sessions and bootstrap", () => {
    it("supports UTF-8 and old Latin-1 session names without trimming the signing secret", async () => {
        const payload = { sub: "id", email: "operator@example.com", name: "Jos\u00e9", exp: Math.floor(Date.now() / 1000) + 60 }
        expect((await verifySession(signed(payload, "latin1")))?.name).toBe(payload.name)
        const token = await createSession("id", payload.email, "Jos\u00e9 \u6771")
        expect((await verifySession(token))?.name).toBe("Jos\u00e9 \u6771")
    })

    it("fails closed for missing secrets, malformed/expired claims and legacy identities", async () => {
        const payload = { sub: "id", email: "operator@example.com", exp: Math.floor(Date.now() / 1000) }
        for (const value of [payload, { ...payload, exp: "9999999999" }, { ...payload, exp: 9999999999, email: "admin@localhost" }]) {
            expect(await verifySession(signed(value))).toBeNull()
        }
        vi.stubEnv("DASHBOARD_JWT_SECRET", "")
        await expect(createSession("id", payload.email, "A")).rejects.toThrow()
        expect(await verifySession(signed({ ...payload, exp: 9999999999 }))).toBeNull()
    })

    it("keeps password hashes compatible and rejects malformed hashes", async () => {
        const hash = await hashPassword("existing-password")
        expect(await verifyPassword("existing-password", hash)).toBe(true)
        expect(await verifyPassword("different", hash)).toBe(false)
        expect(await verifyPassword("anything", "malformed:hash")).toBe(false)
    })

    it("does not create an administrator from known defaults", async () => {
        db.count.mockResolvedValue(0)
        await expect(ensureDefaultUser()).rejects.toThrow("Configure")
        expect(db.upsert).not.toHaveBeenCalled()
    })

    it("provisions only operator-configured credentials without overwriting existing users", async () => {
        db.count.mockResolvedValue(0)
        vi.stubEnv("DASHBOARD_ADMIN_EMAIL", "operator@example.com")
        vi.stubEnv("DASHBOARD_ADMIN_PASSWORD", "unique-test-password")
        await ensureDefaultUser()
        expect(db.upsert.mock.calls[0][0].update).toEqual({})
        expect(await verifyPassword("unique-test-password", db.upsert.mock.calls[0][0].create.password)).toBe(true)
        db.count.mockResolvedValue(1)
        await ensureDefaultUser()
        expect(db.upsert).toHaveBeenCalledTimes(1)
    })

    it("requires explicit operator opt-in to recover only the untouched legacy identity", async () => {
        const legacy = { id: "old", email: "admin@localhost", password: await hashPassword("admin") }
        db.findUnique.mockResolvedValue(legacy)
        await ensureDefaultUser()
        expect(db.updateMany).not.toHaveBeenCalled()
        vi.stubEnv("DASHBOARD_RESET_LEGACY_ADMIN", "true")
        vi.stubEnv("DASHBOARD_ADMIN_EMAIL", "operator@example.com")
        vi.stubEnv("DASHBOARD_ADMIN_PASSWORD", "unique-test-password")
        await ensureDefaultUser()
        expect(db.updateMany.mock.calls[0][0].where).toEqual(legacy)
        db.updateMany.mockClear()
        db.findUnique.mockResolvedValue({ ...legacy, password: await hashPassword("changed-by-operator") })
        await ensureDefaultUser()
        expect(db.updateMany).not.toHaveBeenCalled()
    })

    it("sets secure production cookies", () => {
        vi.stubEnv("NODE_ENV", "production")
        const response = new Response()
        setSessionCookie(response, "test")
        expect(response.headers.get("Set-Cookie")).toContain("; Secure")
        expect(response.headers.get("Set-Cookie")).toContain("HttpOnly")
    })
})

describe("login endpoint", () => {
    async function load() {
        vi.resetModules()
        return (await import("@/app/dashboard/api/login/route")).POST
    }
    function request(email = "operator@example.com", password: unknown = "test-password", ip = "1.1.1.1") {
        return new Request("https://proxy.example/dashboard/api/login", {
            method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
            body: JSON.stringify({ email, password, newEmail: "attacker@example.com", newPassword: "anything" }),
        })
    }
    it("rejects legacy credentials and does not expose credential replacement over HTTP", async () => {
        db.findUnique.mockResolvedValue({ id: "old", email: "admin@localhost", password: await hashPassword("admin") })
        const post = await load()
        expect((await post(request("admin@localhost", "admin"))).status).toBe(401)
        expect(db.updateMany).not.toHaveBeenCalled()
    })
    it("bounds simultaneous attempts despite spoofed forwarding headers", async () => {
        const post = await load()
        const responses = await Promise.all(Array.from({ length: 16 }, (_, n) => post(request("operator@example.com", "wrong", String(n)))))
        expect(responses.filter(r => r.status === 429)).toHaveLength(8)
        expect(db.findUnique).toHaveBeenCalledTimes(8)
        expect(responses.find(r => r.status === 429)?.headers.get("Retry-After")).toBeTruthy()
    })
    it("accepts a valid operator and ignores remote credential-change fields", async () => {
        db.findUnique.mockResolvedValue({ id: "user-id", email: "operator@example.com", name: "Operator", password: await hashPassword("test-password") })
        const post = await load()
        const response = await post(request())
        expect(response.status).toBe(200)
        expect(response.headers.get("Set-Cookie")).toContain("dashboard_token=")
        expect(db.updateMany).not.toHaveBeenCalled()
    })
    it("rejects malformed/oversized input before querying storage", async () => {
        const post = await load()
        for (const value of [null, 5, {}, "x".repeat(257)]) expect((await post(request("operator@example.com", value))).status).toBe(400)
        expect(db.findUnique).not.toHaveBeenCalled()
    })
    it("allows attempts again after expiry and caps many distinct accounts", async () => {
        vi.resetModules()
        const { reserveLoginAttempt } = await import("@/lib/dashboard/login-limiter")
        for (let n = 0; n < 8; n++) expect(reserveLoginAttempt("User@example.com", 1000)).toBe(0)
        expect(reserveLoginAttempt("user@example.com", 1000)).toBeGreaterThan(0)
        expect(reserveLoginAttempt("user@example.com", 901001)).toBe(0)
        for (let n = 0; n < 99; n++) reserveLoginAttempt(n + "@example.com", 901001)
        expect(reserveLoginAttempt("another@example.com", 901001)).toBeGreaterThan(0)
    })
})
