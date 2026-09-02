import { cookies } from "next/headers"
import { prisma } from "@/lib/database"
import { verifySession } from "./session"
export { createSession, verifySession } from "./session"

const COOKIE_NAME = "dashboard_token"
const SESSION_DURATION = 24 * 60 * 60 // 24 hours in seconds

// --- Password Hashing (PBKDF2 via Web Crypto) ---

const ITERATIONS = 100_000
const KEY_LENGTH = 64
const HASH_ALGORITHM = "SHA-512"

async function derivePBKDF2(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    )
    return crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: HASH_ALGORITHM },
        keyMaterial,
        KEY_LENGTH * 8
    )
}

function bufToHex(buf: ArrayBuffer): string {
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
}

function hexToBuf(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
    }
    return bytes
}

export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(32))
    const derived = await derivePBKDF2(password, salt)
    return `${bufToHex(salt.buffer as ArrayBuffer)}:${bufToHex(derived)}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    if (!/^[0-9a-f]{64}:[0-9a-f]{128}$/.test(storedHash)) return false
    const [saltHex, hashHex] = storedHash.split(":")
    if (!saltHex || !hashHex) return false
    const salt = hexToBuf(saltHex)
    const derived = await derivePBKDF2(password, salt)
    const derivedHex = bufToHex(derived)
    // Constant-time comparison
    if (derivedHex.length !== hashHex.length) return false
    let mismatch = 0
    for (let i = 0; i < derivedHex.length; i++) {
        mismatch |= derivedHex.charCodeAt(i) ^ hashHex.charCodeAt(i)
    }
    return mismatch === 0
}

export async function getSessionFromCookies(): Promise<Awaited<ReturnType<typeof verifySession>>> {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE_NAME)?.value
    if (!token) return null
    return verifySession(token)
}

export function setSessionCookie(response: Response, token: string): void {
    response.headers.append(
        "Set-Cookie",
        `${COOKIE_NAME}=${token}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    )
}

export function clearSessionCookie(response: Response): void {
    response.headers.append(
        "Set-Cookie",
        `${COOKIE_NAME}=; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    )
}

// --- User Management ---

export async function ensureDefaultUser() {
    const count = await prisma.dashboardUser.count()
    const resetLegacy = process.env.DASHBOARD_RESET_LEGACY_ADMIN === "true"
    if (count > 0 && !resetLegacy) return

    const email = process.env.DASHBOARD_ADMIN_EMAIL?.trim()
    const password = process.env.DASHBOARD_ADMIN_PASSWORD
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || email.length > 254 || email === "admin@localhost"
        || !password || password.length < 12 || password.length > 256
        || password.startsWith("change-me")) {
        throw new Error("Configure DASHBOARD_ADMIN_EMAIL and a unique DASHBOARD_ADMIN_PASSWORD of at least 12 characters")
    }

    if (count > 0) {
        const legacy = await prisma.dashboardUser.findUnique({ where: { email: "admin@localhost" } })
        if (legacy && await verifyPassword("admin", legacy.password)) {
            await prisma.dashboardUser.updateMany({
                where: { id: legacy.id, email: legacy.email, password: legacy.password },
                data: { email, password: await hashPassword(password) },
            })
        }
        return
    }
    await prisma.dashboardUser.upsert({
        where: { email },
        update: {},
        create: { email, password: await hashPassword(password), name: "Admin" },
    })
}
