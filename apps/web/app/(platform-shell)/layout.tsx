import { redirect } from "next/navigation";
import { AppShell, type NavSection } from "@tm/ui";
import { getPlatformSession } from "@/lib/platform-session";

const API_BASE = "/platform-api";

/**
 * The persistent shell every Super Admin lands on immediately after login (spec FR-001, FR-002).
 * Mirrors `app/(dashboard-shell)/layout.tsx` (Role-Based Dashboard Shell spec) but at the platform
 * level — no tenant subdomain, no must-change-password or missing-role branch (a Super Admin session
 * has neither concept, research.md §5). Lives in the `(platform-shell)` route group (no URL segment
 * of its own) so it wraps `/platform`, `/tenants` (including `/tenants/new`), and `/admin/permissions`
 * under one persistent frame — `/platform/login` stays outside the group, unwrapped. The `Tenants` nav
 * entry's `href` is `/tenants`, not `/tenants/new` — `AppShell`'s `isActiveHref` prefix-matches
 * (`pathname === href || pathname.startsWith(href + "/")`), so `/tenants/new` still highlights it,
 * with no separate active-state handling needed here.
 *
 * Renders through the shared `AppShell` (Desktop Shell Visual Language spec, FR-002a) — the same
 * component the tenant dashboard renders through (Clarifications: both shells converge). Only the
 * props below (nav items, identity) differ.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getPlatformSession();
  if (!session.authenticated) {
    redirect("/platform/login");
  }

  const navSections: NavSection[] = [
    {
      key: "menu",
      entries: [{ key: "home", icon: "home", label: "Home", href: "/platform" }],
    },
    {
      key: "platform-tools",
      entries: [
        {
          key: "provisioning",
          icon: "building2",
          label: "Tenants",
          href: "/tenants",
        },
        {
          key: "permissions",
          icon: "keyRound",
          label: "Permissions",
          href: "/admin/permissions",
        },
      ],
    },
  ];

  return (
    <AppShell
      appMarkLabel="TM"
      appName="TM"
      navSections={navSections}
      identity={{ initial: session.name.charAt(0).toUpperCase(), primary: session.name, secondary: session.email }}
      logoutHref={`${API_BASE}/platform/logout`}
      afterLogoutHref="/platform/login"
    >
      {children}
    </AppShell>
  );
}
