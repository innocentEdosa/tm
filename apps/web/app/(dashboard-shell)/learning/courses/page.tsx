import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import CoursesListClient from "./courses-list-client";

/**
 * The course list (spec 028, US1). Mirrors `training-requests/page.tsx`'s exact session/
 * permission-check pattern — the `(dashboard-shell)` layout already handles plain authentication;
 * this page additionally requires `course.view` or `course.manage`.
 */
export default async function CoursesPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  if (!permissions.includes("course.view") && !permissions.includes("course.manage")) {
    redirect("/dashboard");
  }

  return <CoursesListClient canManage={permissions.includes("course.manage")} subdomain={subdomain} />;
}
