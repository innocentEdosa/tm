"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  LogOut,
  Home,
  Users,
  ShieldCheck,
  BookOpen,
  Building2,
  KeyRound,
  Settings,
  SlidersHorizontal,
  FileText,
  GraduationCap,
  ClipboardList,
  Bell,
  Search,
  X,
  Store,
  ListChecks,
  LayoutGrid,
  Award,
  Target,
  History,
  BarChart3,
  HelpCircle,
} from "lucide-react";

type IconComponent = React.ComponentType<{ className?: string }>;

// Server Components (`(dashboard-shell)/layout.tsx`, `(platform-shell)/layout.tsx`) cannot pass
// component/function references to this Client Component — React Server Component serialization
// only allows plain data across that boundary. Nav items carry an icon *name* instead; this registry
// resolves it to the actual component here, client-side, where the reference never needs to cross a
// server/client prop boundary. Every icon either dashboard's nav items reference must be listed here.
export type IconName = keyof typeof ICONS;

const ICONS = {
  home: Home,
  users: Users,
  shieldCheck: ShieldCheck,
  bookOpen: BookOpen,
  building2: Building2,
  keyRound: KeyRound,
  settings: Settings,
  slidersHorizontal: SlidersHorizontal,
  fileText: FileText,
  graduationCap: GraduationCap,
  clipboardList: ClipboardList,
  store: Store,
  listChecks: ListChecks,
  layoutGrid: LayoutGrid,
  award: Award,
  target: Target,
  history: History,
  barChart3: BarChart3,
  helpCircle: HelpCircle,
} satisfies Record<string, IconComponent>;

export interface NavLinkItem {
  key: string;
  icon: IconName;
  label: string;
  href: string;
  disabled?: boolean;
  count?: string | number;
  tag?: string;
}

export interface NavGroup {
  key: string;
  icon: IconName;
  label: string;
  children: NavLinkItem[];
}

export type NavEntry = NavLinkItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

export interface NavSection {
  key: string;
  entries: NavEntry[];
}

export interface AppShellProps {
  appMarkLabel: string;
  appName: string;
  workspaceLabel?: string;
  navSections: NavSection[];
  /** Utility nav rows pinned in the footer, above Log out (e.g. Settings) — never part of the
   * scrollable nav above, so they stay visible regardless of how long that list gets. Accepts a
   * `NavGroup` (expandable, e.g. "Settings" with Authentication/Forms children) as well as plain
   * links, rendered via the same `renderEntry` the main nav sections use. */
  footerEntries?: NavEntry[];
  identity: { initial: string; primary: string; secondary?: string; avatarUrl?: string };
  /** The topbar row above the content area (search, notifications, signed-in identity). Fully
   * optional — every field has a sensible default, since neither global search nor notifications
   * have a real backend yet; this only renders the chrome, ready to wire up later. */
  topbar?: {
    searchPlaceholder?: string;
    onSearch?: (query: string) => void;
    hasUnreadNotifications?: boolean;
    onNotificationsClick?: () => void;
  };
  logoutHref: string;
  afterLogoutHref: string;
  children: React.ReactNode;
}

/** A link is active on its own exact route, or on any sub-route beneath it (e.g. `/learning/tna/new`
 * and `/learning/tna/[id]` both count as "on" `/learning/tna`) — so a create/edit sub-page still
 * highlights the list page's own nav entry instead of going dark. No existing nav href is a prefix
 * of another distinct route, so widening from exact-match to this doesn't risk a false positive
 * elsewhere. */
function isActiveHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function entryIsActive(entry: NavEntry, pathname: string): boolean {
  if (isGroup(entry)) {
    return entry.children.some((child) => !child.disabled && isActiveHref(pathname, child.href));
  }
  return !entry.disabled && isActiveHref(pathname, entry.href);
}

// Hidden for now (not removed — flip this back to re-enable). The topbar's own search doesn't
// search anything real yet; the empty `<div />` fallback below keeps the actions group right-
// aligned in the same `justify-between` row it already used, rather than switching layouts.
const SHOW_TOPBAR_SEARCH = false;

/**
 * Shared desktop shell (Desktop Shell Visual Language spec) — a single fixed-width sidebar (brand
 * mark, optional workspace-label pill, sectioned/expandable nav, bottom-pinned identity block), a
 * topbar (search, notifications, signed-in identity), and a content slot. No separate icon rail
 * (spec FR-001/FR-004). Rendered identically by both the tenant dashboard and the Super Admin
 * platform dashboard (spec FR-002a); any visual difference between the two comes entirely from the
 * props each caller passes in, never from branching in here.
 */
export function AppShell({
  appMarkLabel,
  appName,
  workspaceLabel,
  navSections,
  footerEntries,
  identity,
  topbar,
  logoutHref,
  afterLogoutHref,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    topbar?.onSearch?.(searchQuery);
  }

  // Every group defaults closed, even one containing the active route — a closed group still peeks
  // its one active child through beneath the (unhighlighted) toggle row, rather than fully hiding it.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleLogout() {
    await fetch(logoutHref, { method: "POST", credentials: "include" });
    router.push(afterLogoutHref);
    router.refresh();
  }

  function renderLink(item: NavLinkItem, indented: boolean) {
    const Icon = ICONS[item.icon];
    const active = !item.disabled && isActiveHref(pathname, item.href);
    const className = indented ? "shell-nav-item shell-nav-item-indented" : "shell-nav-item";

    if (item.disabled) {
      return (
        <span
          key={item.key}
          className={className}
          data-disabled="true"
          title="Coming soon — check back later."
        >
          <Icon className="shell-nav-item-icon" />
          <span className="shell-nav-item-label">{item.label}</span>
          {item.tag && <span className="shell-nav-tag">{item.tag}</span>}
        </span>
      );
    }

    return (
      <Link key={item.key} href={item.href} className={className} data-active={active}>
        <Icon className="shell-nav-item-icon" />
        <span className="shell-nav-item-label">{item.label}</span>
        {item.count !== undefined && <span className="shell-nav-count">{item.count}</span>}
        {item.tag && <span className="shell-nav-tag">{item.tag}</span>}
      </Link>
    );
  }

  function renderEntry(entry: NavEntry) {
    if (!isGroup(entry)) {
      return renderLink(entry, false);
    }
    const Icon = ICONS[entry.icon];
    const open = openGroups.has(entry.key);
    // Closed groups still show their one active child (if any) — peeking through beneath a toggle
    // row that itself stays unhighlighted, rather than disappearing entirely until expanded.
    const activeChild = entry.children.find((child) => !child.disabled && isActiveHref(pathname, child.href));
    const visibleChildren = open ? entry.children : activeChild ? [activeChild] : [];
    return (
      <div key={entry.key} className="shell-nav-group">
        <button
          type="button"
          className="shell-nav-item shell-nav-group-toggle"
          data-active={open && entryIsActive(entry, pathname)}
          aria-expanded={open}
          onClick={() => toggleGroup(entry.key)}
        >
          <Icon className="shell-nav-item-icon" />
          <span className="shell-nav-item-label">{entry.label}</span>
          <ChevronDown className="shell-nav-group-chevron" data-open={open} />
        </button>
        {visibleChildren.length > 0 && (
          <div className="shell-nav-group-children">
            {visibleChildren.map((child) => renderLink(child, true))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="shell-sidebar" aria-label="Primary">
        <div className="shell-sidebar-brand">
          <div className="shell-sidebar-mark">{appMarkLabel}</div>
          <span className="shell-sidebar-wordmark">{appName}</span>
        </div>

        {workspaceLabel && (
          <div className="shell-workspace-pill" title={workspaceLabel}>
            <span className="shell-workspace-pill-label">{workspaceLabel}</span>
            <ChevronDown className="shell-workspace-pill-chevron" />
          </div>
        )}

        <nav className="shell-sidebar-nav" aria-label="Sections">
          {navSections.map((section) => (
            <div key={section.key} className="shell-nav-section">
              {section.entries.map((entry) => renderEntry(entry))}
            </div>
          ))}
        </nav>

        {/* Pinned, not part of the scrollable nav above — footer entries and Log out must stay
           visible even when the sections above overflow and scroll. */}
        <div className="shell-sidebar-footer">
          {footerEntries?.map((entry) => renderEntry(entry))}

          <button type="button" className="shell-nav-item" onClick={handleLogout}>
            <LogOut className="shell-nav-item-icon" />
            <span className="shell-nav-item-label">Log out</span>
          </button>

          <div className="shell-profile">
            <span className="shell-profile-avatar">{identity.initial}</span>
            <span className="shell-profile-text">
              <span className="shell-profile-primary">{identity.primary}</span>
              {identity.secondary && (
                <span className="shell-profile-secondary">{identity.secondary}</span>
              )}
            </span>
          </div>
        </div>
      </aside>

      <div className="shell-main">
        <header className="shell-topbar">
          {SHOW_TOPBAR_SEARCH ? (
            <form className="shell-topbar-search" role="search" onSubmit={handleSearchSubmit}>
              <input
                type="search"
                className="shell-topbar-search-input"
                placeholder={topbar?.searchPlaceholder ?? "Search"}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {searchQuery.length > 0 && (
                <button
                  type="button"
                  className="shell-topbar-search-clear-btn"
                  aria-label="Clear search"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <button type="submit" className="shell-topbar-search-btn" aria-label="Search">
                <Search className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <div />
          )}

          <div className="shell-topbar-actions">
            <button
              type="button"
              className="shell-topbar-bell"
              aria-label="Notifications"
              onClick={() => topbar?.onNotificationsClick?.()}
            >
              <Bell className="h-4 w-4" />
              {topbar?.hasUnreadNotifications && <span className="shell-topbar-bell-dot" />}
            </button>

            <div className="shell-topbar-profile">
              <span className="shell-topbar-avatar">
                {identity.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary avatar URL, no next/image domain config for it
                  <img src={identity.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  identity.initial
                )}
              </span>
              <span className="shell-topbar-profile-text">
                <span className="shell-topbar-profile-name">{identity.primary}</span>
                {identity.secondary && <span className="shell-topbar-profile-handle">{identity.secondary}</span>}
              </span>
            </div>
          </div>
        </header>

        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
