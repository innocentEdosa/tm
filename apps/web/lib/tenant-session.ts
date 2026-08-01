import { cache } from "react";
import { cookies } from "next/headers";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";
const TENANT_SESSION_COOKIE_NAME = "tm_tenant_session";

export type TenantSession =
  | { authenticated: false }
  | { authenticated: true; mustChangePassword: true }
  | {
      authenticated: true;
      mustChangePassword: false;
      id: string;
      email: string;
      roleName: string | null;
      permissions: string[];
    };

/**
 * Server-only (Server Components). Reads the `tm_tenant_session` cookie and re-resolves it against
 * apps/api's `/tenant-auth/me`, server-to-server (never through the browser-facing `/tenant-api/*`
 * rewrite — research.md §4-5 of Spec 4/5). Shared by every Server Component that needs to branch on
 * session state (`/tenant`, `/set-password`, `/dashboard`) — de-duplicates what was previously three
 * near-identical copies of this exact cookie-read/fetch/branch logic (research.md §8).
 *
 * Wrapped in React's `cache()` so the layout's own call and each page's call within the same request
 * share one result instead of two round-trips to apps/api — request-scoped only (a fresh cache per
 * render), never a stale-session risk, since Next resets it for every incoming request.
 */
export const getTenantSession = cache(async (subdomain: string): Promise<TenantSession> => {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(TENANT_SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return { authenticated: false };
  }

  const res = await fetch(`${API_ORIGIN}/tenant-auth/me?subdomain=${encodeURIComponent(subdomain)}`, {
    headers: { cookie: `${TENANT_SESSION_COOKIE_NAME}=${sessionCookie.value}` },
    cache: "no-store",
  });
  if (!res.ok) {
    return { authenticated: false };
  }

  const body = (await res.json()) as {
    data: {
      id: string;
      email: string;
      mustChangePassword: boolean;
      roleName: string | null;
      permissions: string[];
    };
  };

  if (body.data.mustChangePassword) {
    return { authenticated: true, mustChangePassword: true };
  }
  return {
    authenticated: true,
    mustChangePassword: false,
    id: body.data.id,
    email: body.data.email,
    roleName: body.data.roleName,
    permissions: body.data.permissions,
  };
});
