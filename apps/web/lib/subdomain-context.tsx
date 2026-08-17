"use client";

import { createContext, useContext } from "react";

/**
 * The course editor tree is deep (editor shell → tab → sub-panel → form, five levels in places like
 * `curriculum-tab.tsx` → `ModuleContentItems` → a content-item form), and nearly every leaf needs
 * `subdomain` for its own `tenantFetch` calls — prop-drilling it through every intermediate component
 * would mean touching components that don't otherwise care about it at all. Every settings page in
 * this app is shallow enough that plain props have always been fine; this tree isn't, so it gets a
 * small scoped context instead.
 */
const SubdomainContext = createContext<string | null>(null);

export function SubdomainProvider({ subdomain, children }: { subdomain: string; children: React.ReactNode }) {
  return <SubdomainContext.Provider value={subdomain}>{children}</SubdomainContext.Provider>;
}

export function useSubdomain(): string {
  const subdomain = useContext(SubdomainContext);
  if (subdomain === null) {
    throw new Error("useSubdomain must be used within a SubdomainProvider");
  }
  return subdomain;
}

/** Non-throwing counterpart — for a component reused by BOTH a tenant tree (wrapped in
 * `SubdomainProvider`) and a platform tree (never wrapped, since platform routes have no tenant
 * subdomain at all), where reading the subdomain is only conditionally needed (e.g.
 * `create-course-menu.tsx`'s AI generation call, tenant-only via `CourseEditorApi.supportsAiGeneration`).
 * `useSubdomain()` above stays the throwing default for every tree that always has a provider — this
 * exists only for the one genuinely-optional case, not as a blanket replacement. */
export function useOptionalSubdomain(): string | null {
  return useContext(SubdomainContext);
}
