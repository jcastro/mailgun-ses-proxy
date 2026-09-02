import { randomUUID } from "node:crypto"
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest"

const testUrl = process.env.TEST_DATABASE_URL
describe.skipIf(!testUrl)("dashboard identity limits (real MySQL)", () => {
    let prisma: typeof import("@/lib/database").prisma
    let post: typeof import("@/app/dashboard/api/login/route").POST
    const id = randomUUID()
    const email = "review-" + id + "@example.com"
    beforeAll(async () => {
        if (!testUrl || !new URL(testUrl).pathname.endsWith("_test")) throw new Error("A dedicated *_test database is required")
        vi.stubEnv("DATABASE_URL", testUrl)
        vi.stubEnv("DASHBOARD_JWT_SECRET", "test-only-session-secret-at-least-32-characters")
        vi.stubEnv("DASHBOARD_RESET_LEGACY_ADMIN", "")
        vi.resetModules()
        ;({ prisma } = await import("@/lib/database"))
        const { hashPassword } = await import("@/lib/dashboard/auth")
        await prisma.dashboardUser.create({ data: { id, email, password: await hashPassword("unique-test-password"), name: "Test" } })
        ;({ POST: post } = await import("@/app/dashboard/api/login/route"))
    })
    afterAll(async () => {
        if (!prisma) return
        await prisma.dashboardUser.deleteMany({ where: { id } })
        await prisma.$disconnect()
        vi.unstubAllEnvs()
    })
    it("treats collation-equivalent emails as a single stored account for throttling", async () => {
        const aliases = [email, email.replace("review", "r\u00e9view"), email.replace("review", "r\u00e8view")]
        for (const alias of aliases) expect((await prisma.dashboardUser.findUnique({ where: { email: alias } }))?.id).toBe(id)
        const results = await Promise.all(aliases.flatMap(alias => Array.from({ length: 8 }, () => post(new Request("https://proxy.example/dashboard/api/login", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: alias, password: "wrong" }),
        })))))
        expect(results.filter(r => r.status === 401)).toHaveLength(8)
        expect(results.filter(r => r.status === 429)).toHaveLength(16)
    })
})
