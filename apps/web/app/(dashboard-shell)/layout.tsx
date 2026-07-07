import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell, type NavSection, type NavLinkItem, type NavEntry } from "@tm/ui";
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

  // Granular Permissions addendum: each nav-visibility check also accepts the new narrow key
  // introduced alongside its module's legacy "manage" superset — a role holding only the granular
  // key (never granted the superset) still sees the nav entry it needs.
  const canManageTeam = session.permissions.includes("manage_team_members") || session.permissions.includes("team.create");
  const canManageAuth = session.permissions.includes("manage_authentication_settings");
  const canManageDepartments = session.permissions.includes("department.manage");
  const canViewDepartments = canManageDepartments || session.permissions.includes("department.view");
  const canManageForms = session.permissions.includes("forms.manage.tenant") || session.permissions.includes("forms.tenant.read");
  const canManageRoles = session.permissions.includes("manage_roles") || session.permissions.includes("roles.read");

  const navSections: NavSection[] = [
    {
      key: "menu",
      entries: [
        { key: "home", icon: "home", label: "Home", href: "/dashboard" },
        { key: "courses", icon: "bookOpen", label: "Courses", href: "/courses", disabled: true, tag: "Soon" },
      ],
    },
  ];

  if (canManageTeam || canViewDepartments || canManageRoles) {
    const administrationChildren: NavLinkItem[] = [];
    if (canManageTeam) {
      administrationChildren.push({ key: "members", icon: "users", label: "Members", href: "/settings/team" });
    }
    if (canViewDepartments) {
      administrationChildren.push({
        key: "department",
        icon: "building2",
        label: "Department",
        href: "/settings/department",
      });
    }
    // spec FR-015/Assumptions (Roles Management UI) — gated specifically on `manage_roles`, not the
    // broader condition this array otherwise shares, and no longer disabled. The former standalone
    // "Permission" entry is removed entirely (FR-016/SC-006); its function now lives inside Roles.
    if (canManageRoles) {
      administrationChildren.push({
        key: "roles",
        icon: "shieldCheck",
        label: "Roles",
        href: "/settings/roles",
      });
    }

    navSections.push({
      key: "administration",
      entries: [
        {
          key: "administration",
          icon: "settings",
          label: "Administration",
          children: administrationChildren,
        },
      ],
    });
  }

  // "Settings" (spec FR-011/FR-012, User Story 5) — a system-configuration concern, deliberately
  // distinct from "Administration" (people/access). Pinned in the footer, above Log out, not part
  // of the scrollable nav above. Authentication moved here from its own former footer entry; its
  // route (/settings/authentication) is unchanged, so no redirect is needed (plan.md Summary).
  const footerEntries: NavEntry[] = [];
  if (canManageAuth || canManageForms) {
    const settingsChildren: NavLinkItem[] = [];
    if (canManageAuth) {
      settingsChildren.push({
        key: "auth-settings",
        icon: "shieldCheck",
        label: "Authentication",
        href: "/settings/authentication",
      });
    }
    if (canManageForms) {
      settingsChildren.push({
        key: "forms",
        icon: "fileText",
        label: "Forms",
        href: "/settings/forms",
      });
    }

    footerEntries.push({
      key: "settings",
      icon: "slidersHorizontal",
      label: "Settings",
      children: settingsChildren,
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
