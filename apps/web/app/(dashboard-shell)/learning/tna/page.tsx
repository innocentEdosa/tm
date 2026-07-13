import { headers } from "next/headers";
import { getTenantSession } from "@/lib/tenant-session";
import TrainingNeedsClient from "./training-needs-client";

export default async function TrainingNeedsPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  return (
    <TrainingNeedsClient
      subdomain={subdomain}
      canViewAll={permissions.includes("tna.view.all")}
      canManageAll={permissions.includes("tna.manage.all")}
      canManageDepartment={permissions.includes("tna.manage.department")}
    />
  );
}
