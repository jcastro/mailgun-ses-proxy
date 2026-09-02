import { afterEach, describe, expect, it, vi } from "vitest"
const { session } = vi.hoisted(() => ({ session: vi.fn() }))
vi.mock("@/lib/dashboard/auth", () => ({ getSessionFromCookies: session }))
import { GET, PUT } from "@/app/dashboard/api/settings/route"

describe("deployment settings", () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
    it("shows actual deployment keys, never credentials", async () => {
        session.mockResolvedValue({ sub: "admin" })
        vi.stubEnv("NEWSLETTER_QUEUE", "https://sqs.example.com/live-queue")
        vi.stubEnv("NEWSLETTER_QUEUE_URL", "unused-legacy-value")
        vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret-not-for-dashboard")
        const result = await GET()
        const data = await result.json()
        expect(data.readOnly).toBe(true)
        expect(data.settings).toContainEqual(expect.objectContaining({ key: "NEWSLETTER_QUEUE", value: "https://sqs.example.com/live-queue" }))
        expect(JSON.stringify(data)).not.toContain("unused-legacy-value")
        expect(JSON.stringify(data)).not.toContain("secret-not-for-dashboard")
    })
    it("rejects writes instead of accepting ineffective overrides", async () => {
        session.mockResolvedValue({ sub: "admin" })
        const result = await PUT()
        expect(result.status).toBe(405)
        expect(result.headers.get("allow")).toBe("GET")
    })
    it("requires a verified session for reads and writes", async () => {
        session.mockResolvedValue(null)
        expect((await GET()).status).toBe(401)
        expect((await PUT()).status).toBe(401)
    })
})
