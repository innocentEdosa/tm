import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import TnaExerciseForm from "../tna-exercise-form";

export default async function NewTnaExercisePage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  if (!permissions.includes("tna.manage")) {
    redirect("/strategy/training-needs-analysis");
  }

  return <TnaExerciseForm subdomain={subdomain} />;
}
