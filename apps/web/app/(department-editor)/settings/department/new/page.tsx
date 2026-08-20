import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import DepartmentForm from "../department-form";

export default async function NewDepartmentPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  const canCreate = permissions.includes("department.manage") || permissions.includes("department.create");
  if (!canCreate) redirect("/settings/department");

  return <DepartmentForm subdomain={subdomain} />;
}
