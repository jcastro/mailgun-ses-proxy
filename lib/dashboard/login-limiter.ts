const WINDOW_MS = 15 * 60 * 1000
const MAX_ACCOUNTS = 1000
const accounts = new Map<string, { count: number; until: number }>()
let globalWindow = { count: 0, until: 0 }

// Reserve synchronously, before database/hash work. Never trust forwarded IP headers.
export function reserveAccountAttempt(key: string, now = Date.now()): number {
    for (const [key, value] of accounts) {
        if (value.until <= now) accounts.delete(key)
    }
    const entry = accounts.get(key) ?? { count: 0, until: now + WINDOW_MS }
    if (entry.count >= 8) return Math.ceil((entry.until - now) / 1000)
    if (!accounts.has(key) && accounts.size >= MAX_ACCOUNTS) return 60
    entry.count++
    accounts.set(key, entry)
    return 0
}

export function reserveLoginAttempt(email: string, now = Date.now()): number {
    if (globalWindow.until <= now) globalWindow = { count: 0, until: now + 60_000 }
    if (globalWindow.count >= 100) return Math.ceil((globalWindow.until - now) / 1000)
    const retryAfter = reserveAccountAttempt("email:" + email.trim().toLowerCase(), now)
    if (retryAfter) return retryAfter
    globalWindow.count++
    return 0
}
