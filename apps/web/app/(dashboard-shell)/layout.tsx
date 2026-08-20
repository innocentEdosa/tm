import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell, type NavSection, type NavLinkItem, type NavEntry } from "@tm/ui";
import { getTenantSession } from "@/lib/tenant-session";
import { AiAssistantLauncher } from "@/app/_shared/ai-assistant/ai-assistant-launcher";
import { AiPageContextProvider } from "@/app/_shared/ai-assistant/ai-page-context";

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
  // Team Member Directory spec (012): a pure viewer (team.view.all/team.view.department, no
  // create/manage) must still see "Members" — the directory itself is this spec's whole point.
  const canManageTeam =
    session.permissions.includes("manage_team_members") ||
    session.permissions.includes("team.create") ||
    session.permissions.includes("team.view.all") ||
    session.permissions.includes("team.view.department");
  const canManageAuth = session.permissions.includes("manage_authentication_settings");
  // Granular Permissions addendum: department has its own create/edit/delete keys alongside the
  // legacy `department.manage` superset (migration 0038) — this check previously tested only
  // `department.manage`, so a role holding just `department.create` (say) never saw the nav entry
  // at all, unlike every other module's nav check in this file, which already accounts for its own
  // granular keys (canManageTeam, canAccessTna, etc.).
  const canManageDepartments =
    session.permissions.includes("department.manage") ||
    session.permissions.includes("department.create") ||
    session.permissions.includes("department.edit") ||
    session.permissions.includes("department.delete");
  const canViewDepartments = canManageDepartments || session.permissions.includes("department.view");
  const canManageForms = session.permissions.includes("forms.manage.tenant") || session.permissions.includes("forms.tenant.read");
  const canManageRoles = session.permissions.includes("manage_roles") || session.permissions.includes("roles.read");
  // Training Request spec (014, renamed by spec 020) — a pure viewer (training_request.view.all/
  // training_request.view.department, no manage grant) must still see this entry, same reasoning as
  // Team's view-only visibility above. A pure approver (training_request.approve, no view/manage
  // grant — the approval-workflow follow-up) needs the same treatment: they can open any entry
  // directly by id, so they need a way to reach the list too.
  const canAccessTna =
    session.permissions.includes("training_request.view.all") ||
    session.permissions.includes("training_request.view.department") ||
    session.permissions.includes("training_request.manage.all") ||
    session.permissions.includes("training_request.manage.department") ||
    session.permissions.includes("training_request.approve");
  // Business Objectives (Strategy nav) — tenant-wide, no department scope, so unlike canAccessTna
  // there's just a single view/manage pair (no `.all`/`.department` split).
  const canAccessBusinessObjective =
    session.permissions.includes("business_objective.manage") ||
    session.permissions.includes("business_objective.view");
  // Training Needs Analysis (the real, HR-initiated exercise — distinct from `canAccessTna` above,
  // which is actually Training Request's own flag, kept unrenamed since spec 020 only renamed the
  // feature's user-facing labels, not its internal identifiers). Same single view/manage pair shape
  // as Business Objectives, for the same reason: TNA authoring is inherently org-wide HR
  // administration, not department-scoped self-service. `hasTnaAssignment` (tenant-auth/
  // tenant-auth-routes.ts's `/tenant-auth/me`) additionally shows this entry to a plain assigned
  // participant who holds neither `tna.manage` nor `tna.view` — reached via department manager/
  // assistant-manager, role, or direct-user targeting, all of which resolve into the same
  // `tna_assignments` ownership check, so one flag covers every targeting mechanism.
  const canAccessTnaAnalysis =
    session.permissions.includes("tna.manage") ||
    session.permissions.includes("tna.view") ||
    session.hasTnaAssignment;
  // Course Marketplace spec (029) — browsing and selecting reuses course.manage, no new permission
  // key (spec Clarifications, locked scope).
  const canAccessCourseMarketplace = session.permissions.includes("course.manage");

  const navSections: NavSection[] = [
    {
      key: "menu",
      entries: [{ key: "home", icon: "home", label: "Dashboard", href: "/dashboard" }],
    },
  ];

  // Course Creation UI spec (028): course.view/course.manage gate this entry, same view-only
  // visibility pattern as Training Requests above (canAccessTna) — a pure course.view holder needs
  // the list too, not just direct-by-id links.
  const canAccessCourses =
    session.permissions.includes("course.view") || session.permissions.includes("course.manage");

  // "My Learning" — the learner-facing entry point (courses assigned to *me*, with my own progress),
  // split out into its own top-level group, peer to "Studio" (the admin-facing content-management
  // side, below) rather than nested under it. Unconditionally visible — accessible by everyone, not
  // gated on `course.view`/`course.manage` (those stay "Studio"-only, below); the page and every API
  // call it makes rely on assignment-based visibility, not a permission key, to decide what's shown.
  navSections.push({
    key: "my-learning",
    entries: [
      {
        key: "my-learning",
        icon: "graduationCap",
        label: "My Learning",
        children: [{ key: "my-courses", icon: "layoutGrid", label: "My Courses", href: "/learning/my-courses" }],
      },
    ],
  });

  // "Strategy" (sidebar restructure) — replaces the former "Training Plan" group. The section itself
  // now shows for canAccessTna, canAccessBusinessObjective, OR canAccessTnaAnalysis (any one
  // feature's permission is enough to see "Strategy" at all); each real child entry is then
  // independently included only for callers who actually hold its own permission, so e.g. a
  // Business-Objective-only caller doesn't also see the (still permission-gated) Training Request
  // or TNA entries. "Annual Learning Plan" remains a permanent disabled stub.
  if (canAccessTna || canAccessBusinessObjective || canAccessTnaAnalysis) {
    navSections.push({
      key: "strategy",
      entries: [
        {
          key: "strategy",
          icon: "clipboardList",
          label: "Strategy",
          children: [
            ...(canAccessBusinessObjective
              ? [{ key: "business-objective", icon: "target" as const, label: "Business Objective", href: "/learning/business-objective" }]
              : [{ key: "business-objective", icon: "target" as const, label: "Business Objective", href: "/learning/business-objective", disabled: true, tag: "Soon" }]),
            { key: "annual-learning-plan", icon: "bookOpen", label: "Annual Learning Plan", href: "/learning/annual-learning-plan", disabled: true, tag: "Soon" },
            ...(canAccessTnaAnalysis
              ? [{ key: "tna", icon: "fileText" as const, label: "Training Needs Analysis", href: "/strategy/training-needs-analysis" }]
              : [{ key: "tna", icon: "fileText" as const, label: "Training Needs Analysis", href: "/strategy/training-needs-analysis", disabled: true, tag: "Soon" }]),
            ...(canAccessTna
              ? [{ key: "training-request", icon: "clipboardList" as const, label: "Training Request", href: "/learning/training-requests" }]
              : []),
          ],
        },
      ],
    });
  }

  // "Studio" (sidebar restructure) — replaces the former "Learning" group. "Content Builder" is the
  // existing Courses page (unchanged href/permission, spec 028) and "Resource Library" is the
  // existing Course Marketplace entry (unchanged href/permission, spec 029) — only the labels moved.
  // "Assessment Builder" and "Learning Paths" are new disabled "Coming soon" stubs, same convention
  // as every other not-yet-built entry in this file. The old "Learning Program" stub is retired —
  // "Learning Paths" below now covers that same not-yet-built concept.
  if (canAccessCourses || canAccessCourseMarketplace) {
    const studioChildren: NavLinkItem[] = [];
    if (canAccessCourses) {
      studioChildren.push({ key: "content-builder", icon: "bookOpen", label: "Content Builder", href: "/learning/courses" });
    }
    if (canAccessCourseMarketplace) {
      studioChildren.push({ key: "resource-library", icon: "fileText", label: "Resource Library", href: "/learning/marketplace" });
    } else {
      studioChildren.push({
        key: "resource-library",
        icon: "fileText",
        label: "Resource Library",
        href: "/learning/learning-resources",
        disabled: true,
        tag: "Soon",
      });
    }
    studioChildren.push(
      { key: "assessment-builder", icon: "listChecks", label: "Assessment Builder", href: "/learning/assessment-builder", disabled: true, tag: "Soon" },
      { key: "learning-paths", icon: "route", label: "Learning Paths", href: "/learning/learning-paths", disabled: true, tag: "Soon" },
    );
    navSections.push({
      key: "studio",
      entries: [
        {
          key: "studio",
          icon: "layers",
          label: "Studio",
          children: studioChildren,
        },
      ],
    });
  }

  // "Skill Profile" (sidebar restructure, formerly "Skills Profile") — same unconditional visibility
  // as before (no permission model exists for any of this yet — same reasoning as "Dashboard" itself
  // never being gated). "Analytics" replaces the old "Reports & Analytics" child now that "Reports &
  // Insights" has its own top-level entry below; "Learning Goals"/"Learning History" are unchanged.
  navSections.push({
    key: "skill-profile",
    entries: [
      {
        key: "skill-profile",
        icon: "award",
        label: "Skill Profile",
        children: [
          { key: "learning-goals", icon: "target", label: "Learning Goals", href: "/learning/goals", disabled: true, tag: "Soon" },
          { key: "analytics", icon: "trendingUp", label: "Analytics", href: "/learning/analytics", disabled: true, tag: "Soon" },
          { key: "learning-history", icon: "history", label: "Learning History", href: "/learning/history", disabled: true, tag: "Soon" },
        ],
      },
    ],
  });

  // "Reports & Insights" (sidebar restructure) — a new top-level, flat entry (no children),
  // unconditionally visible like "Skill Profile" above (no backend yet), disabled until it has a
  // real destination.
  navSections.push({
    key: "reports-insights",
    entries: [{ key: "reports-insights", icon: "barChart3", label: "Reports & Insights", href: "/learning/reports-insights", disabled: true, tag: "Soon" }],
  });

  // "Settings" (spec FR-011/FR-012, User Story 5) — a system-configuration concern, deliberately
  // distinct from "Administration" (people/access). Pinned in the footer, above Log out, not part
  // of the scrollable nav above. Authentication moved here from its own former footer entry; its
  // route (/settings/authentication) is unchanged, so no redirect is needed (plan.md Summary).
  const footerEntries: NavEntry[] = [];

  // "Administration" — moved into the footer (pinned above Settings/Log out, alongside them) rather
  // than the scrollable nav above, so it reads as account/workspace-level administration rather than
  // a peer of the day-to-day Studio/Strategy sections.
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

    footerEntries.push({
      key: "administration",
      icon: "settings",
      label: "Administration",
      children: administrationChildren,
    });
  }

  {
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
    // AI Activity (AI Foundation Phase 2) — unconditional, like "My Learning": this is a personal
    // history of the current user's own AI conversations/tool actions, not a permission-gated
    // administrative screen (docs/ai-foundation-architecture.md's "own activity, not tenant-wide"
    // scope decision), so every tenant user who has talked to the assistant can find it here
    // regardless of what else they're allowed to manage.
    settingsChildren.push({
      key: "ai-activity",
      icon: "sparkles",
      label: "AI Activity",
      href: "/settings/ai-activity",
    });

    footerEntries.push({
      key: "settings",
      icon: "slidersHorizontal",
      label: "Settings",
      children: settingsChildren,
    });
  }

  return (
    <AppShell
      appMarkLabel={tenantName.charAt(0).toUpperCase() || "T"}
      appName={tenantName}
      navSections={navSections}
      footerEntries={footerEntries}
      identity={{ initial: session.email.charAt(0).toUpperCase(), primary: session.email, secondary: session.roleName ?? undefined }}
      logoutHref={`${API_BASE}/logout?subdomain=${encodeURIComponent(subdomain)}`}
      afterLogoutHref="/tenant"
    >
      <AiPageContextProvider>
        {children}
        <AiAssistantLauncher subdomain={subdomain} />
      </AiPageContextProvider>
    </AppShell>
  );
}
