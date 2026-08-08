import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import CourseMarketplaceDetailClient from "./course-marketplace-detail-client";

/**
 * A single marketplace course's full preview — deliberately lives outside `(dashboard-shell)` (no
 * admin sidebar/topbar chrome), the same reasoning as `(course-player)/learning/play/[courseId]`:
 * a course preview reads better as its own focused, full-screen page than squeezed into the app
 * shell's content well. Since there's no longer a `(dashboard-shell)/layout.tsx` wrapping this route
 * to provide the session guard, it's repeated here directly (course-player's page.tsx precedent).
 */
export default async function CourseMarketplaceDetailPage({
  params,
}: {
  params: Promise<{ platformCourseId: string }>;
}) {
  const { platformCourseId } = await params;
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";

  const session = await getTenantSession(subdomain);
  if (!session.authenticated) {
    redirect("/tenant");
  }
  if (session.mustChangePassword) {
    redirect("/set-password");
  }

  return <CourseMarketplaceDetailClient subdomain={subdomain} platformCourseId={platformCourseId} />;
}
