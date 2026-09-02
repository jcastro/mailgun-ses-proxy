const SESSION_DURATION = 24 * 60 * 60

function getJwtSecret(): string {
    const secret = process.env.DASHBOARD_JWT_SECRET
    if (!secret || secret === "mailgun-ses-proxy-dashboard-secret-change-me"
        || secret === "change-me-to-another-long-random-value") {
        throw new Error("Configure a unique DASHBOARD_JWT_SECRET")
    }
    return secret
}

function decodePayload(value: string): string {
    const binary = base64UrlDecode(value)
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)))
    } catch {
        // Older sessions encoded Latin-1 names with btoa directly.
        return binary
    }
}

// --- JWT Session (HMAC-SHA256 via Web Crypto) ---

async function getSigningKey(): Promise<CryptoKey> {
    const encoder = new TextEncoder()
    return crypto.subtle.importKey(
        "raw",
        encoder.encode(getJwtSecret()),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    )
}

function base64UrlEncode(data: string | ArrayBuffer): string {
    const str = typeof data === "string"
        ? btoa(String.fromCharCode(...new TextEncoder().encode(data)))
        : btoa(String.fromCharCode(...new Uint8Array(data)))
    return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlDecode(str: string): string {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/")
    return atob(padded)
}

interface JWTPayload {
    sub: string
    email: string
    name: string
    iat: number
    exp: number
}

export async function createSession(userId: string, email: string, name: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const payload: JWTPayload = {
        sub: userId,
        email,
        name: name || email,
        iat: now,
        exp: now + SESSION_DURATION,
    }

    const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const body = base64UrlEncode(JSON.stringify(payload))
    const signingInput = `${header}.${body}`

    const key = await getSigningKey()
    const encoder = new TextEncoder()
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput))

    return `${signingInput}.${base64UrlEncode(signature)}`
}

export async function verifySession(token: string): Promise<JWTPayload | null> {
    try {
        const parts = token.split(".")
        if (parts.length !== 3 || token.length > 8192) return null
        const header = JSON.parse(base64UrlDecode(parts[0]))
        if (header.alg !== "HS256" || header.typ !== "JWT") return null

        const signingInput = `${parts[0]}.${parts[1]}`
        const signature = Uint8Array.from(base64UrlDecode(parts[2]), (c) => c.charCodeAt(0))

        const key = await getSigningKey()
        const encoder = new TextEncoder()
        const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(signingInput))
        if (!valid) return null

        const payload: JWTPayload = JSON.parse(decodePayload(parts[1]))
        if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)
            || typeof payload.sub !== "string" || !payload.sub
            || typeof payload.email !== "string" || !payload.email
            || payload.email === "admin@localhost") return null

        return payload
    } catch {
        return null
    }
}
