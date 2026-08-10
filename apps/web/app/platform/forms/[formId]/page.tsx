import { redirect } from "next/navigation";
import { getPlatformSession } from "@/lib/platform-session";
import { FormBuilderClient } from "./form-builder-client";

/**
 * Server-side auth gate for the full-screen Form Builder workspace, mirroring the check
 * `(platform-shell)/layout.tsx` performs for every route under that shell — this route lives
 * outside the shell (no AppShell chrome, full viewport for the three-pane builder) so it must
 * redo the same `getPlatformSession()` redirect itself rather than inheriting it.
 */
export default async function PlatformFormBuilderPage({ params }: { params: Promise<{ formId: string }> }) {
  const session = await getPlatformSession();
  if (!session.authenticated) {
    redirect("/platform/login");
  }
  const { formId } = await params;
  return <FormBuilderClient formId={formId} />;
}
