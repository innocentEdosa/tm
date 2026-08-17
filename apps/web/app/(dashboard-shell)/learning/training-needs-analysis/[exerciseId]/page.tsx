import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import TnaExerciseDetailClient from "./tna-exercise-detail-client";

export default async function TnaExerciseDetailPage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await params;
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  const canManage = permissions.includes("tna.manage");
  const canView = canManage || permissions.includes("tna.view");
  if (!canView) redirect("/learning/training-needs-analysis");

  return <TnaExerciseDetailClient subdomain={subdomain} exerciseId={exerciseId} canManage={canManage} />;
}
