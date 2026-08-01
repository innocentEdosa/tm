import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import CourseEditorClient from "./course-editor-client";

/**
 * The course editor (spec 028, US2/US3/FR-014) — Details + Curriculum tabs, used for both a
 * freshly-created course (landing here right after setup) and editing any existing mock course.
 * Mirrors `training-requests/[id]/page.tsx`'s exact session/permission-check pattern. The mock store
 * is client-only (research.md §3), so this Server Component does no data fetching of its own — it just
 * passes `courseId` through.
 */
export default async function CourseEditorPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];
  const currentUserEmail = session.authenticated && !session.mustChangePassword ? session.email : "";

  if (!permissions.includes("course.view") && !permissions.includes("course.manage")) {
    redirect("/dashboard");
  }

  return (
    <CourseEditorClient
      courseId={courseId}
      canManage={permissions.includes("course.manage")}
      currentUserEmail={currentUserEmail}
      subdomain={subdomain}
    />
  );
}
