import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/tenant-session";
import TenantFormBuilderClient from "./tenant-form-builder-client";

/**
 * Server-side auth gate for the full-screen Form Builder workspace, mirroring the check
 * `(dashboard-shell)/layout.tsx` performs for every route under that shell — this route lives
 * outside the shell (no AppShell chrome, full viewport for the builder canvas + live preview,
 * matching the Super Admin's Platform Forms builder at `app/platform/forms/[formId]/page.tsx`)
 * so it must redo the same `getTenantSession()` redirect itself rather than inheriting it.
 */
export default async function TenantFormBuilderPage({ params }: { params: Promise<{ formKey: string }> }) {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";

  const session = await getTenantSession(subdomain);
  if (!session.authenticated) {
    redirect("/tenant");
  }
  if (session.mustChangePassword) {
    redirect("/set-password");
  }

  const { formKey } = await params;
  return <TenantFormBuilderClient formKey={formKey} subdomain={subdomain} />;
}
