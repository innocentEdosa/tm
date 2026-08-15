import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import CreateCourseClient from "./create-course-client";

/**
 * The fullscreen "Create a course" page — replaces the old "Untitled course" quick-create (which
 * dropped straight into the tabbed editor with placeholder details) with an upfront details step,
 * matching the reference product's fullscreen creation flow. Lives in its own route group
 * (`(course-creation)`, no `layout.tsx`) so it renders with none of `(dashboard-shell)`'s sidebar/
 * topbar chrome — same "no shell" pattern as `(course-player)`.
 */
export default async function CreateCoursePage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];
  const currentUserEmail = session.authenticated && !session.mustChangePassword ? session.email : "";

  if (!permissions.includes("course.manage")) {
    redirect("/learning/courses");
  }

  return <CreateCourseClient subdomain={subdomain} currentUserEmail={currentUserEmail} />;
}
