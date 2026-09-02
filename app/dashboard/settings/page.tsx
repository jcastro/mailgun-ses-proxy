import { getSessionFromCookies } from "@/lib/dashboard/auth"
import { getDeploymentSettings } from "@/lib/dashboard/settings"
import { redirect } from "next/navigation"

export default async function SettingsPage() {
    if (!await getSessionFromCookies()) redirect("/dashboard/login")
    return (
        <div className="space-y-6 min-w-0">
            <h1 className="text-2xl font-bold">Deployment configuration</h1>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left table-fixed">
                    <thead><tr className="border-b"><th className="p-3 w-1/2">Setting</th><th className="p-3">Environment value</th></tr></thead>
                    <tbody>{getDeploymentSettings().map(setting => (
                        <tr key={setting.key} className="border-b">
                            <th className="p-3 font-normal align-top break-words">{setting.label}<div className="font-mono text-xs text-muted-foreground break-all">{setting.key}</div></th>
                            <td className="p-3 align-top break-all font-mono">{setting.value || "Not set"}</td>
                        </tr>
                    ))}</tbody>
                </table>
            </div>
        </div>
    )
}
