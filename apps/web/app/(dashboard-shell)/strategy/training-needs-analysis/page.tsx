import { headers } from "next/headers";
import { getTenantSession } from "@/lib/tenant-session";
import TnaListClient from "./tna-list-client";

export default async function TnaExercisesPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  const canManage = permissions.includes("tna.manage");
  const canView = canManage || permissions.includes("tna.view");

  // No redirect here even when !canView — a participant with a real assignment but no admin
  // permission still needs to reach this page (assignment-based visibility, same as "My Learning").
  // The client fetches `/tenant/my-tna-assignments` regardless of `canView`/`canManage`.
  return <TnaListClient subdomain={subdomain} canManage={canManage} canView={canView} />;
}
