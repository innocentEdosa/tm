"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, Settings, Users, ShieldCheck, BookOpen, LogOut, ChevronLeft, ChevronRight } from "lucide-react";

const API_BASE = "/tenant-api/tenant-auth";
const COLLAPSED_STORAGE_KEY = "tm_sidebar_collapsed";

type CategoryKey = "settings" | "courses";

/**
 * Two-tier sidebar (icon rail + category panel), per the reference screenshot the user supplied —
 * research.md §5 originally deferred this exact pattern until there were enough destinations to
 * justify it; the user asked for it directly, so this supersedes that decision. "Home" is a rail-only
 * destination (no sub-items, navigates directly); "Settings" is a real category whose panel lists
 * whichever of Team Members / Authentication Settings the user has permission for; "Courses" has no
 * real page yet, so its rail icon only ever opens a "coming soon" panel, never navigates (FR-005).
 * Icons are from lucide-react, not hand-drawn SVGs.
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
      icon: Users,
    },
    permissions.includes("manage_authentication_settings") && {
      label: "Authentication Settings",
      href: "/settings/authentication",
      icon: ShieldCheck,
    },
  ].filter(
    (item): item is { label: string; href: string; icon: typeof Users } => Boolean(item),
  );

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
          <Home className="sidebar-rail-icon" strokeWidth={1.75} />
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
            <Settings className="sidebar-rail-icon" strokeWidth={1.75} />
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
          <BookOpen className="sidebar-rail-icon" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          className="sidebar-rail-btn mt-auto"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleCollapsed}
        >
          {collapsed ? (
            <ChevronRight className="sidebar-rail-icon" strokeWidth={1.75} />
          ) : (
            <ChevronLeft className="sidebar-rail-icon" strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          className="sidebar-rail-btn"
          aria-label="Log out"
          title="Log out"
          onClick={handleLogout}
        >
          <LogOut className="sidebar-rail-icon" strokeWidth={1.75} />
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
                <item.icon className="sidebar-panel-item-icon" strokeWidth={1.75} />
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
