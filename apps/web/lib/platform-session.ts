import { cookies } from "next/headers";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";
const SUPER_ADMIN_COOKIE_NAME = "tm_super_admin_session";

export type PlatformSession =
  | { authenticated: false }
  | {
      authenticated: true;
      id: string;
      email: string;
      name: string;
      lastLoginAt: string | null;
      isSuperAdminFlagSet: boolean;
    };

/**
 * Server-only (Server Components). Mirrors `tenant-session.ts`'s role but for the platform level —
 * reads the `tm_super_admin_session` cookie and re-resolves it against apps/api's `/platform/me`,
 * server-to-server. No `subdomain` parameter: this shell operates strictly at the root domain, never
 * a tenant subdomain (spec FR-007).
 */
export async function getPlatformSession(): Promise<PlatformSession> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SUPER_ADMIN_COOKIE_NAME);
  if (!sessionCookie) {
    return { authenticated: false };
  }

  const res = await fetch(`${API_ORIGIN}/platform/me`, {
    headers: { cookie: `${SUPER_ADMIN_COOKIE_NAME}=${sessionCookie.value}` },
    cache: "no-store",
  });
  if (!res.ok) {
    return { authenticated: false };
  }

  const body = (await res.json()) as {
    data: {
      id: string;
      email: string;
      name: string;
      lastLoginAt: string | null;
      isSuperAdminFlagSet: boolean;
    };
  };

  return { authenticated: true, ...body.data };
}
