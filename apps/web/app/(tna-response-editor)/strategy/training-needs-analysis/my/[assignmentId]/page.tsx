import { headers } from "next/headers";
import { getTenantSession } from "@/lib/tenant-session";
import { redirect } from "next/navigation";
import TnaMyResponseClient from "./tna-my-response-client";

export default async function TnaMyResponsePage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const session = await getTenantSession(subdomain);
  if (!session.authenticated || session.mustChangePassword) {
    redirect("/tenant");
  }

  return <TnaMyResponseClient subdomain={subdomain} assignmentId={assignmentId} />;
}
