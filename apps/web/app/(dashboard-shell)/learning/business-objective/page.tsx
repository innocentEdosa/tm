import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import BusinessObjectivesClient from "./business-objectives-client";

export default async function BusinessObjectivesPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  const canManage = permissions.includes("business_objective.manage");
  const canView = canManage || permissions.includes("business_objective.view");
  if (!canView) redirect("/");

  return <BusinessObjectivesClient subdomain={subdomain} canManage={canManage} />;
}
