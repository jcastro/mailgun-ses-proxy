import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authentication } from "./lib/authentication";
import logger from "./lib/core/logger";
import { verifySession } from "./lib/dashboard/session";

const log = logger.child({ path: "middleware" })

const WHITELIST = ["/healthcheck"];
const DASHBOARD_PUBLIC_PATHS = ["/dashboard/login", "/dashboard/api/login"];

/**
 * Main middleware entry point.
 * Routes requests to specialized handlers based on the path.
 */
export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // 1. Whitelist / Healthchecks
    if (WHITELIST.includes(pathname)) {
        return NextResponse.next();
    }

    // 2. Dashboard routes (Cookie-based auth)
    if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
        return handleDashboardAuth(request);
    }

    // 3. API routes (Basic auth with API key)
    return handleApiAuth(request);
}

/**
 * Handles authentication for the dashboard UI and internal dashboard APIs.
 */
async function handleDashboardAuth(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Security: Enforce presence of JWT secret
    if (!process.env.DASHBOARD_JWT_SECRET) {
        log.warn("DASHBOARD_JWT_SECRET env var is missing. Dashboard is unavailable.");
        return new Response("Dashboard Unavailable", { status: 503 });
    }

    // Allow public paths (login) without auth
    if (DASHBOARD_PUBLIC_PATHS.includes(pathname)) {
        return NextResponse.next();
    }

    const token = request.cookies.get("dashboard_token")?.value;
    const isApiRequest = pathname.startsWith("/dashboard/api/");
    const loginUrl = new URL("/dashboard/login", request.url);

    // If no token, either 401 for API or redirect for UI
    if (!token) {
        return isApiRequest 
            ? Response.json({ error: "authentication required" }, { status: 401 }) 
            : NextResponse.redirect(loginUrl);
    }

    if (!await verifySession(token)) {
        return isApiRequest 
            ? Response.json({ error: "invalid session" }, { status: 401 })
            : NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

/**
 * Handles authentication for public/external API routes using Basic Auth.
 */
async function handleApiAuth(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    
    if (authHeader && await authentication(authHeader)) {
        return NextResponse.next();
    }

    log.error({ path: request.nextUrl.pathname }, "API authentication failed: missing or invalid API key");
    return Response.json({ error: 'authentication failed' }, { status: 401 });
}

export const config = {
    matcher: ["/((?!_next/static/|_next/image$|favicon.ico$).*)"],
};
