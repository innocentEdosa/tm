import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import TrainingNeedView from "./training-need-view";

export default async function ViewTrainingNeedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  const canManageAll = permissions.includes("tna.manage.all");
  const canManageDepartment = permissions.includes("tna.manage.department");
  const canViewAll = permissions.includes("tna.view.all");
  const canViewDepartment = permissions.includes("tna.view.department");
  if (!canManageAll && !canManageDepartment && !canViewAll && !canViewDepartment) {
    redirect("/learning/tna");
  }

  return (
    <TrainingNeedView
      subdomain={subdomain}
      trainingNeedId={id}
      canManage={canManageAll || canManageDepartment}
    />
  );
}
