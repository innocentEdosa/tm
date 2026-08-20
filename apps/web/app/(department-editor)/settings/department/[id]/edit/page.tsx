import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import DepartmentForm from "../../department-form";

export default async function EditDepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  const canEdit = permissions.includes("department.manage") || permissions.includes("department.edit");
  if (!canEdit) redirect("/settings/department");

  return <DepartmentForm subdomain={subdomain} departmentId={id} />;
}
