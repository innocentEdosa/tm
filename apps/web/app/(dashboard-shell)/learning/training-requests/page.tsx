import { headers } from "next/headers";
import { getTenantSession } from "@/lib/tenant-session";
import TrainingNeedsClient from "./training-needs-client";

export default async function TrainingNeedsPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  // A permission that lets you act on any entry (manage.all) or approve any entry
  // (training_request.approve) implies the same org-wide, unpaginated-vs-paginated list rendering
  // training_request.view.all gets — mirrors the API's own "manage implies view" broadening for
  // this same list endpoint.
  const canViewAll =
    permissions.includes("training_request.view.all") ||
    permissions.includes("training_request.manage.all") ||
    permissions.includes("training_request.approve");

  return (
    <TrainingNeedsClient
      subdomain={subdomain}
      canViewAll={canViewAll}
      canManageAll={permissions.includes("training_request.manage.all")}
      canManageDepartment={permissions.includes("training_request.manage.department")}
    />
  );
}
