import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import TrainingNeedForm from "../training-need-form";

export default async function NewTrainingNeedPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  const canManageAll = permissions.includes("tna.manage.all");
  const canManageDepartment = permissions.includes("tna.manage.department");
  if (!canManageAll && !canManageDepartment) {
    redirect("/learning/tna");
  }

  return <TrainingNeedForm subdomain={subdomain} canManageAll={canManageAll} />;
}
