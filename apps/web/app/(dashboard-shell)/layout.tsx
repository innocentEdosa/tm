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
  const canManageDepartments = session.permissions.includes("department.manage");
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
  // split out into its own top-level group, peer to "Learning" (the admin-facing catalog/management
  // side) rather than nested under it. Unconditionally visible — accessible by everyone, not gated on
  // `course.view`/`course.manage` (those stay "Learning"-only, below); the page and every API call it
  // makes rely on assignment-based visibility, not a permission key, to decide what's actually shown.
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

  // "Learning" (Training Request spec, 014, renamed by spec 020) — a new top-level section, peer to
  // "Administration" and "Settings" (plan.md Summary). The old top-level disabled "Courses"
  // placeholder (research.md §8) is now this section's "Courses" entry, live per spec 028 rather than
  // a permanent "Soon" stub. "Learning Resources" (previously a disabled "Soon" stub) is repointed at
  // the Course Marketplace (spec 029) rather than getting its own separate nav entry — browsing the
  // Super-Admin-curated catalog *is* this tenant's "learning resources" concept, gated on the same
  // course.manage permission. "Learning Program" stays a disabled "Soon" stub until its own spec lands.
  if (canAccessCourses || canAccessCourseMarketplace) {
    const learningChildren: NavLinkItem[] = [];
    if (canAccessCourses) {
      learningChildren.push({ key: "courses", icon: "bookOpen", label: "Courses", href: "/learning/courses" });
    }
    learningChildren.push({
      key: "learning-program",
      icon: "graduationCap",
      label: "Learning Program",
      href: "/learning/learning-program",
      disabled: true,
      tag: "Soon",
    });
    if (canAccessCourseMarketplace) {
      learningChildren.push({ key: "learning-resources", icon: "fileText", label: "Learning Resources", href: "/learning/marketplace" });
    } else {
      learningChildren.push({
        key: "learning-resources",
        icon: "fileText",
        label: "Learning Resources",
        href: "/learning/learning-resources",
        disabled: true,
        tag: "Soon",
      });
    }
    navSections.push({
      key: "learning",
      entries: [
        {
          key: "learning",
          icon: "bookOpen",
          label: "Learning",
          children: learningChildren,
        },
      ],
    });
  }

  // "Training Plan" — a new top-level group (its own section, peer to "Learning"/"Administration")
  // holding the training-request workflow's 3-part IA: today only "Training Request" has a real page
  // (the existing training-request/training-need feature — same backend under either name, only the
  // nav label changed across specs 014/020); "Training Needs Analysis" and "Training Plan" are
  // disabled "Coming soon" stubs until their own specs land, same convention as the pre-028 "Courses"
  // placeholder above.
  if (canAccessTna) {
    navSections.push({
      key: "training-plan",
      entries: [
        {
          key: "training-plan",
          icon: "clipboardList",
          label: "Training Plan",
          children: [
            { key: "tna", icon: "fileText", label: "Training Needs Analysis", href: "/learning/training-needs-analysis", disabled: true, tag: "Soon" },
            { key: "training-request", icon: "clipboardList", label: "Training Request", href: "/learning/training-requests" },
            { key: "training-plan-item", icon: "bookOpen", label: "Training Plan", href: "/learning/training-plan", disabled: true, tag: "Soon" },
          ],
        },
      ],
    });
  }

  // "Skills Profile" — a new top-level group, unconditionally visible (no permission model exists
  // for any of this yet — same reasoning as "Dashboard" itself never being gated). All 3 children are
  // disabled "Coming soon" stubs, same convention as Training Plan's placeholders above.
  navSections.push({
    key: "skills-profile",
    entries: [
      {
        key: "skills-profile",
        icon: "award",
        label: "Skills Profile",
        children: [
          { key: "learning-goals", icon: "target", label: "Learning Goals", href: "/learning/goals", disabled: true, tag: "Soon" },
          { key: "learning-history", icon: "history", label: "Learning History", href: "/learning/history", disabled: true, tag: "Soon" },
          { key: "reports-analytics", icon: "barChart3", label: "Reports & Analytics", href: "/learning/reports", disabled: true, tag: "Soon" },
        ],
      },
    ],
  });

  // "Help & Support" — a flat top-level entry (no children), also unconditionally visible and
  // disabled until it has a real destination, same reasoning as "Skills Profile" above.
  navSections.push({
    key: "help-support",
    entries: [{ key: "help-support", icon: "helpCircle", label: "Help & Support", href: "/help", disabled: true, tag: "Soon" }],
  });

  // "Settings" (spec FR-011/FR-012, User Story 5) — a system-configuration concern, deliberately
  // distinct from "Administration" (people/access). Pinned in the footer, above Log out, not part
  // of the scrollable nav above. Authentication moved here from its own former footer entry; its
  // route (/settings/authentication) is unchanged, so no redirect is needed (plan.md Summary).
  const footerEntries: NavEntry[] = [];

  // "Administration" — moved into the footer (pinned above Settings/Log out, alongside them) rather
  // than the scrollable nav above, so it reads as account/workspace-level administration rather than
  // a peer of the day-to-day Learning/Training Plan sections.
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
