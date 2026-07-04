"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const API_BASE = "/tenant-api/tenant-auth";
const COLLAPSED_STORAGE_KEY = "tm_sidebar_collapsed";

function HomeIcon() {
  return (
    <svg className="sidebar-rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.5 12 4l9 7.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 9.5V20h14V9.5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="sidebar-rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="12" cy="12" r="3" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.4 13a7.7 7.7 0 0 0 0-2l1.9-1.5-2-3.4-2.3.6a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.3 2.7a7.6 7.6 0 0 0-1.7 1l-2.3-.6-2 3.4L6.6 11a7.7 7.7 0 0 0 0 2l-1.9 1.5 2 3.4 2.3-.6a7.6 7.6 0 0 0 1.7 1L11 21h4l.3-2.7a7.6 7.6 0 0 0 1.7-1l2.3.6 2-3.4Z"
      />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg className="sidebar-panel-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="9" cy="8" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 5.5a3 3 0 0 1 0 5.9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 14.2c2.5.4 4.5 2.3 4.5 4.8" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="sidebar-panel-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3.5 5 6v5.5c0 4.4 3 7.8 7 9 4-1.2 7-4.6 7-9V6l-7-2.5Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="m9.5 12 1.75 1.75L14.5 10" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg className="sidebar-rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5.5c2-1 5-1 8 0v13c-3-1-6-1-8 0v-13Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 5.5c-2-1-5-1-8 0v13c3-1 6-1 8 0v-13Z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="sidebar-rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 16.5 20 12l-4.5-4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H9" />
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className="sidebar-rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      {collapsed ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
      )}
    </svg>
  );
}

type CategoryKey = "settings" | "courses";

/**
 * Two-tier sidebar (icon rail + category panel), per the reference screenshot the user supplied —
 * research.md §5 originally deferred this exact pattern until there were enough destinations to
 * justify it; the user asked for it directly, so this supersedes that decision. "Home" is a rail-only
 * destination (no sub-items, navigates directly); "Settings" is a real category whose panel lists
 * whichever of Team Members / Authentication Settings the user has permission for; "Courses" has no
 * real page yet, so its rail icon only ever opens a "coming soon" panel, never navigates (FR-005).
 */
export default function DashboardSidebar({
  roleName,
  permissions,
  subdomain,
}: {
  roleName: string;
  permissions: string[];
  subdomain: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [expandedCategory, setExpandedCategory] = useState<CategoryKey | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Keep the panel in sync with direct navigation (fresh load, back/forward), not just rail clicks.
  useEffect(() => {
    if (pathname.startsWith("/settings/")) {
      setExpandedCategory("settings");
    } else if (pathname === "/dashboard") {
      setExpandedCategory(null);
    }
  }, [pathname]);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  }

  async function handleLogout() {
    await fetch(`${API_BASE}/logout?subdomain=${encodeURIComponent(subdomain)}`, {
      method: "POST",
      credentials: "include",
    });
    router.push("/tenant");
    router.refresh();
  }

  const settingsItems = [
    permissions.includes("manage_team_members") && {
      label: "Team Members",
      href: "/settings/team",
      icon: UsersIcon,
    },
    permissions.includes("manage_authentication_settings") && {
      label: "Authentication Settings",
      href: "/settings/authentication",
      icon: ShieldIcon,
    },
  ].filter((item): item is { label: string; href: string; icon: () => React.ReactElement } => Boolean(item));

  return (
    <div className="flex">
      <nav className="sidebar-rail" aria-label="Dashboard sections">
        <div className="sidebar-rail-badge" title={roleName}>
          {roleName.charAt(0)}
        </div>

        <Link
          href="/dashboard"
          className="sidebar-rail-btn"
          data-active={pathname === "/dashboard"}
          aria-label="Home"
          title="Home"
        >
          <HomeIcon />
        </Link>

        {settingsItems.length > 0 && (
          <button
            type="button"
            className="sidebar-rail-btn"
            data-active={expandedCategory === "settings"}
            aria-label="Settings"
            title="Settings"
            onClick={() => setExpandedCategory((prev) => (prev === "settings" ? null : "settings"))}
          >
            <SettingsIcon />
          </button>
        )}

        <button
          type="button"
          className="sidebar-rail-btn"
          data-active={expandedCategory === "courses"}
          aria-label="Courses"
          title="Courses — coming soon"
          onClick={() => setExpandedCategory((prev) => (prev === "courses" ? null : "courses"))}
        >
          <BookIcon />
        </button>

        <button
          type="button"
          className="sidebar-rail-btn mt-auto"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleCollapsed}
        >
          <CollapseIcon collapsed={collapsed} />
        </button>
        <button
          type="button"
          className="sidebar-rail-btn"
          aria-label="Log out"
          title="Log out"
          onClick={handleLogout}
        >
          <LogoutIcon />
        </button>
      </nav>

      <div className="sidebar-panel" data-collapsed={collapsed}>
        {expandedCategory === "settings" && (
          <>
            <p className="sidebar-panel-heading">Settings</p>
            {settingsItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="sidebar-panel-item"
                data-active={pathname === item.href}
              >
                <item.icon />
                {item.label}
              </Link>
            ))}
          </>
        )}

        {expandedCategory === "courses" && (
          <>
            <p className="sidebar-panel-heading">Courses</p>
            <p className="sidebar-panel-empty">Coming soon — check back later.</p>
          </>
        )}
      </div>
    </div>
  );
}
