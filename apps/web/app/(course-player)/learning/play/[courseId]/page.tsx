import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import CoursePlayerClient from "./course-player-client";

/**
 * The learner "learning area" — video/article/live-class/SCORM player plus a Udemy-style curriculum
 * sidebar. Opened in a new tab from a My Courses card (or the Upcoming Learnings panel), so this
 * route deliberately lives outside `(dashboard-shell)` — no admin sidebar/topbar chrome, just this
 * page's own minimal header. Mirrors every other tenant page's session/permission-check pattern
 * (`learning/my-courses/page.tsx`); the same `course.view`/`course.manage` gate every course route
 * already requires, with per-course assignment visibility enforced by `GET /courses/:courseId` itself.
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
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  if (!permissions.includes("course.view") && !permissions.includes("course.manage")) {
    redirect("/dashboard");
  }

  return <CoursePlayerClient courseId={courseId} subdomain={subdomain} initialContentItemId={item ?? null} />;
}
