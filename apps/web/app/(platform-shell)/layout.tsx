import { redirect } from "next/navigation";
import { getPlatformSession } from "@/lib/platform-session";
import PlatformSidebar from "./platform-sidebar";

/**
 * The persistent shell every Super Admin lands on immediately after login (spec FR-001, FR-002).
 * Mirrors `app/(dashboard-shell)/layout.tsx` (Role-Based Dashboard Shell spec) but at the platform
 * level — no tenant subdomain, no must-change-password or missing-role branch (a Super Admin session
 * has neither concept, research.md §5). Lives in the `(platform-shell)` route group (no URL segment
 * of its own) so it wraps `/platform`, `/provisioning/new`, and `/admin/permissions` under one
 * persistent frame — `/platform/login` stays outside the group, unwrapped.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getPlatformSession();
  if (!session.authenticated) {
    redirect("/platform/login");
  }

  return (
    <div className="flex min-h-screen">
      <PlatformSidebar name={session.name} />
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
