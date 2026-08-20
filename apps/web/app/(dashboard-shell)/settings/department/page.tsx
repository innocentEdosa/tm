import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import DepartmentSettingsClient from "./department-settings-client";

export default async function DepartmentSettingsPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  // Department has its own granular create/edit/delete keys alongside the legacy `department.manage`
  // superset (Granular Permissions addendum, migration 0038) — checked individually here, mirroring
  // layout.tsx's own nav-visibility fix, rather than collapsing to one "canManage" flag the way
  // Business Objectives does (which only ever had a single manage/view pair).
  const canCreate = permissions.includes("department.manage") || permissions.includes("department.create");
  const canEdit = permissions.includes("department.manage") || permissions.includes("department.edit");
  const canDelete = permissions.includes("department.manage") || permissions.includes("department.delete");
  const canView = canCreate || canEdit || canDelete || permissions.includes("department.view");
  if (!canView) redirect("/");

  return <DepartmentSettingsClient subdomain={subdomain} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
}
