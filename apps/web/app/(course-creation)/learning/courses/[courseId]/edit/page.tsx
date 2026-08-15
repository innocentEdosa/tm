import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import CreateCourseClient from "@/app/(course-creation)/learning/courses/create/create-course-client";

/**
 * "On edit" — reopens an existing course in the same fullscreen, step-based flow as
 * `/learning/courses/create`, instead of the old tabbed editor. Same "no shell" route group as
 * `create/page.tsx` (`(course-creation)`, no `layout.tsx`). The old tabbed editor
 * (`(dashboard-shell)/learning/courses/[courseId]/page.tsx`) is left fully in place — it's still
 * reachable directly.
 */
export default async function EditCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];
  const currentUserEmail = session.authenticated && !session.mustChangePassword ? session.email : "";

  if (!permissions.includes("course.manage")) {
    redirect("/learning/courses");
  }

  return <CreateCourseClient subdomain={subdomain} courseId={courseId} currentUserEmail={currentUserEmail} />;
}
