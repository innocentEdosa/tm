import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import MyCoursesClient from "./my-courses-client";

/**
 * My Courses — every course assigned to the signed-in user (directly, via department, via role, or
 * "everyone"), with their own progress and an upcoming-learnings panel. Mirrors
 * `learning/courses/page.tsx`'s exact session/permission-check pattern; the actual course list itself
 * is already assignment-filtered server-side (`GET /tenant/courses`), so this page does no filtering
 * of its own beyond the same `course.view`/`course.manage` gate every course route already requires.
 */
export default async function MyCoursesPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  if (!permissions.includes("course.view") && !permissions.includes("course.manage")) {
    redirect("/dashboard");
  }

  return <MyCoursesClient subdomain={subdomain} />;
}
