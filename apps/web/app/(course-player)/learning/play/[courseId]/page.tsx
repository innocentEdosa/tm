import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import CoursePlayerClient from "./course-player-client";

/**
 * The learner "learning area" — video/article/live-class/SCORM player plus a Udemy-style curriculum
 * sidebar. Opened in a new tab from a My Courses card (or the Upcoming Learnings panel), so this
 * route deliberately lives outside `(dashboard-shell)` — no admin sidebar/topbar chrome, just this
 * page's own minimal header. Open to any authenticated tenant user, same as `learning/my-courses/
 * page.tsx` ("My Learning accessible by everyone") — per-course assignment visibility is enforced by
 * the backend itself (`isCourseVisibleToCaller`, used by `GET /courses/:courseId` and every other
 * route this page's data calls hit), not a permission key here.
 */
export default async function CoursePlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { courseId } = await params;
  const { item } = await searchParams;
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);

  if (!session.authenticated) {
    redirect("/tenant");
  }
  if (session.mustChangePassword) {
    redirect("/set-password");
  }

  return <CoursePlayerClient courseId={courseId} subdomain={subdomain} initialContentItemId={item ?? null} />;
}
