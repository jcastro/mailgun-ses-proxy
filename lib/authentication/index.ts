import { timingSafeEqual } from "crypto";
import logger from "@/lib/core/logger";

const log = logger.child({ path: "service/authenticate" })

export async function authentication(token: string) {
    try {
        const validApiKey = process.env.API_KEY
        if (!validApiKey) {
            log.error("API_KEY env var is missing")
            return false
        }

        const parts = token.match(/^Basic\s+(.+)$/i)
        if (!parts?.[1]) {
            log.warn("Malformed authorization header: missing credentials")
            return false
        }
        const raw = Buffer.from(parts[1], "base64").toString("utf-8")
        const validKey = "api:" + validApiKey
        if (raw.length !== validKey.length) {
            return false
        }
        if (timingSafeEqual(Buffer.from(raw), Buffer.from(validKey))) {
            return true;
        }
    } catch (error) {
        log.error({ error }, "Error in authentication")
    }
    return false
}
