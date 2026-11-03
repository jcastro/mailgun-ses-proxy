import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"))
const packages = lock.packages as Record<string, { version?: string }>

describe("security floors in the shipped dependency lockfile", () => {
    it.each([
        ["next", "16.4.1"],
        ["sharp", "0.35.5"],
        ["vitest", "4.1.12"],
        ["@vitest/mocker", "4.1.12"],
    ])("keeps every copy of %s at or above its patched version %s", (name, minimum) => {
        const copies = Object.entries(packages).filter(([path]) => path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`)

        expect(copies.length).toBeGreaterThan(0)
        for (const [path, entry] of copies) {
            const version = entry.version || ""
            expect(version, path).toMatch(/^\d+\.\d+\.\d+$/)
            expect(version.localeCompare(minimum, "en", { numeric: true }), path).toBeGreaterThanOrEqual(0)
        }
    })

    it("keeps the Next environment and all native compiler targets on the same release", () => {
        const version = packages["node_modules/next"].version
        expect(packages["node_modules/@next/env"].version).toBe(version)
        const compilers = Object.entries(packages).filter(([path]) => path.startsWith("node_modules/@next/swc-"))

        expect(compilers.length).toBeGreaterThan(0)
        for (const [path, entry] of compilers) expect(entry.version, path).toBe(version)
    })
})
