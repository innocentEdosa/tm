import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import BusinessObjectiveForm from "../../business-objective-form";

export default async function EditBusinessObjectivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  const permissions = session.authenticated && !session.mustChangePassword ? session.permissions : [];

  if (!permissions.includes("business_objective.manage")) {
    redirect("/learning/business-objective");
  }

  return <BusinessObjectiveForm subdomain={subdomain} businessObjectiveId={id} />;
}
