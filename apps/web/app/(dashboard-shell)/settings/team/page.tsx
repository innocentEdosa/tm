import { headers } from "next/headers";
import { getTenantSession } from "@/lib/tenant-session";
import TeamSettingsClient from "./team-settings-client";

export default async function TeamSettingsPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  return (
    <TeamSettingsClient
      subdomain={subdomain}
      canViewAll={permissions.includes("team.view.all")}
      canAddMember={permissions.includes("manage_team_members") || permissions.includes("team.create")}
      canManageMembers={permissions.includes("manage_team_members")}
    />
  );
}
