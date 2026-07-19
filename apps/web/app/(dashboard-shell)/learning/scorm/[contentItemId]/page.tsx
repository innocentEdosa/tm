import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import ScormLauncherClient from "./scorm-launcher-client";

/**
 * The SCO launcher page (spec US2, plan.md's first `apps/web`-touching spec in this sequence). Mirrors
 * `training-requests/[id]/page.tsx`'s exact session/permission-check pattern — the `(dashboard-shell)`
 * layout already handles the plain authentication redirect; this page additionally requires
 * `course.view`/`course.manage`, the same access the Learner Progress spec (026) requires to record
 * progress on the underlying content item (research.md §4, contracts §GET launch).
 */
export default async function ScormLauncherPage({
  params,
}: {
  params: Promise<{ contentItemId: string }>;
}) {
  const { contentItemId } = await params;
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  if (!permissions.includes("course.view") && !permissions.includes("course.manage")) {
    redirect("/dashboard");
  }

  return <ScormLauncherClient contentItemId={contentItemId} />;
}
