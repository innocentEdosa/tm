"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, Wrench, Building2, KeyRound, LogOut, ChevronLeft, ChevronRight } from "lucide-react";

const API_BASE = "/platform-api";
const COLLAPSED_STORAGE_KEY = "tm_platform_sidebar_collapsed";

const TOOLS_ITEMS = [
  { label: "Provision Tenant", href: "/provisioning/new", icon: Building2 },
  { label: "Permissions", href: "/admin/permissions", icon: KeyRound },
];

/**
 * Platform-level sidebar (research.md §3, §4, §5) — mirrors the tenant dashboard's two-tier
 * icon-rail + category-panel mechanism and reuses its `sidebar-*` CSS classes verbatim, but with no
 * permission gating: a Super Admin is a single flat role, so every entry is always shown. Icons are
 * from lucide-react, not hand-drawn SVGs.
 */
export default function PlatformSidebar({ name }: { name: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (pathname === "/provisioning/new" || pathname === "/admin/permissions") {
      setToolsOpen(true);
    } else if (pathname === "/platform") {
      setToolsOpen(false);
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
    await fetch(`${API_BASE}/platform/logout`, { method: "POST", credentials: "include" });
    router.push("/platform/login");
    router.refresh();
  }

  return (
    <div className="flex">
      <nav className="sidebar-rail" aria-label="Platform sections">
        <div className="sidebar-rail-badge" title={name}>
          {name.charAt(0)}
        </div>

        <Link
          href="/platform"
          className="sidebar-rail-btn"
          data-active={pathname === "/platform"}
          aria-label="Home"
          title="Home"
        >
          <Home className="sidebar-rail-icon" strokeWidth={1.75} />
        </Link>

        <button
          type="button"
          className="sidebar-rail-btn"
          data-active={toolsOpen}
          aria-label="Platform Tools"
          title="Platform Tools"
          onClick={() => setToolsOpen((prev) => !prev)}
        >
          <Wrench className="sidebar-rail-icon" strokeWidth={1.75} />
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
        {toolsOpen && (
          <>
            <p className="sidebar-panel-heading">Platform Tools</p>
            {TOOLS_ITEMS.map((item) => (
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
      </div>
    </div>
  );
}
