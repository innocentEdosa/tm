import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import MyCoursesClient from "./my-courses-client";

/**
 * My Courses — every course assigned to the signed-in user (directly, via department, via role, or
 * "everyone"), with their own progress and an upcoming-learnings panel. Open to any authenticated
 * tenant user, not gated on `course.view`/`course.manage` — "My Learning" (the nav group this page
 * lives under) is accessible by everyone; per-course visibility is enforced by the backend's own
 * assignment-visibility check (`isCourseVisibleToCaller`), not a permission key. The admin-facing
 * "Courses" catalog (`learning/courses/page.tsx`) still gates on those permissions.
 */
export default async function MyCoursesPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);

  if (!session.authenticated) {
    redirect("/tenant");
  }
  if (session.mustChangePassword) {
    redirect("/set-password");
  }

  return <MyCoursesClient subdomain={subdomain} />;
}
