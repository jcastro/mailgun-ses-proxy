export function normalizeEmailAddress(value: unknown) {
    const raw = String(value || "").trim()
    const address = raw.match(/<([^<>]+)>/)?.[1] || raw
    return address.trim().toLowerCase()
}

export function uniqueNormalizedEmails(values: unknown[]) {
    return Array.from(new Set(values.map(normalizeEmailAddress).filter(Boolean)))
}
