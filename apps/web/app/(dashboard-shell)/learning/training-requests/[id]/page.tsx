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

  const canManageAll = permissions.includes("training_request.manage.all");
  const canManageDepartment = permissions.includes("training_request.manage.department");
  const canViewAll = permissions.includes("training_request.view.all");
  const canViewDepartment = permissions.includes("training_request.view.department");
  const canApprove = permissions.includes("training_request.approve");
  if (!canManageAll && !canManageDepartment && !canViewAll && !canViewDepartment && !canApprove) {
    redirect("/learning/training-requests");
  }

  return (
    <TrainingNeedView
      subdomain={subdomain}
      trainingNeedId={id}
      canManage={canManageAll || canManageDepartment}
      canApprove={canApprove}
    />
  );
}
