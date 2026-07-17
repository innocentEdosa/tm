import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import TrainingNeedForm from "../../training-need-form";

export default async function EditTrainingNeedPage({
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
  if (!canManageAll && !canManageDepartment) {
    redirect("/learning/training-requests");
  }

  return <TrainingNeedForm subdomain={subdomain} trainingNeedId={id} canManageAll={canManageAll} />;
}
