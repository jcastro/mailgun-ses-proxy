import { getSessionFromCookies } from "@/lib/dashboard/auth"
import { getDeploymentSettings } from "@/lib/dashboard/settings"

export async function GET() {
    if (!await getSessionFromCookies()) return Response.json({ error: "Unauthorized" }, { status: 401 })
    return Response.json({ settings: getDeploymentSettings(), readOnly: true })
}

export async function PUT() {
    if (!await getSessionFromCookies()) return Response.json({ error: "Unauthorized" }, { status: 401 })
    return Response.json(
        { error: "Configuration is managed through deployment environment variables." },
        { status: 405, headers: { Allow: "GET" } },
    )
}
