import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell, type NavSection, type NavLinkItem } from "@tm/ui";
import { getTenantSession } from "@/lib/tenant-session";

const API_BASE = "/tenant-api/tenant-auth";

/**
 * The persistent shell every user lands on immediately after login (spec FR-001, FR-002). A Next.js
 * layout, not a duplicated page, so future dashboard content routes inherit this sidebar frame for
 * free (research.md §1). Lives in the `(dashboard-shell)` route group (no URL segment of its own) so
 * it wraps `/dashboard`, `/settings/team`, and `/settings/authentication` all under one persistent
 * frame — the sidebar must stay visible (with correct active-state highlighting) on the pages its own
 * links point to, not just on `/dashboard` itself.
 *
 * Renders through the shared `AppShell` (Desktop Shell Visual Language spec, FR-002a) — the same
 * component the Super Admin platform dashboard renders through. Only the props below (nav items,
 * identity) differ between the two; the shell itself carries no branching.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain") ?? "";
  const tenantName = headerList.get("x-tenant-name") ?? subdomain;

  const session = await getTenantSession(subdomain);
  if (!session.authenticated) {
    redirect("/tenant");
  }
  if (session.mustChangePassword) {
    redirect("/set-password");
  }

  if (!session.roleName) {
    // FR-008 — should not occur in practice (every account is created with exactly one role), but
    // never render a blank page or crash if it somehow does.
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
        <div className="banner-error">
          Your account isn&apos;t assigned a role yet — contact your HR Admin.
        </div>
      </main>
    );
  }

  const canManageTeam = session.permissions.includes("manage_team_members");
  const canManageAuth = session.permissions.includes("manage_authentication_settings");

  const navSections: NavSection[] = [
    {
      key: "menu",
      entries: [
        { key: "home", icon: "home", label: "Home", href: "/dashboard" },
        { key: "courses", icon: "bookOpen", label: "Courses", href: "/courses", disabled: true, tag: "Soon" },
      ],
    },
  ];

  if (canManageTeam) {
    navSections.push({
      key: "administration",
      entries: [
        {
          key: "administration",
          icon: "settings",
          label: "Administration",
          children: [
            { key: "members", icon: "users", label: "Members", href: "/settings/team" },
            {
              key: "department",
              icon: "building2",
              label: "Department",
              href: "/settings/department",
              disabled: true,
              tag: "Soon",
            },
            {
              key: "roles",
              icon: "shieldCheck",
              label: "Roles",
              href: "/settings/roles",
              disabled: true,
              tag: "Soon",
            },
            {
              key: "permission",
              icon: "keyRound",
              label: "Permission",
              href: "/settings/permission",
              disabled: true,
              tag: "Soon",
            },
          ],
        },
      ],
    });
  }

  const footerEntries: NavLinkItem[] = [];
  if (canManageAuth) {
    footerEntries.push({
      key: "auth-settings",
      icon: "shieldCheck",
      label: "Authentication Settings",
      href: "/settings/authentication",
    });
  }

  return (
    <AppShell
      appMarkLabel="TM"
      appName="TM"
      workspaceLabel={tenantName}
      navSections={navSections}
      footerEntries={footerEntries}
      identity={{ initial: session.email.charAt(0).toUpperCase(), primary: session.email, secondary: session.roleName ?? undefined }}
      logoutHref={`${API_BASE}/logout?subdomain=${encodeURIComponent(subdomain)}`}
      afterLogoutHref="/tenant"
    >
      {children}
    </AppShell>
  );
}
