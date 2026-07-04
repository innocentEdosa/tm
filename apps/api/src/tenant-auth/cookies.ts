export { parseCookie } from "../platform-auth/cookies";

export const TENANT_USER_COOKIE_NAME = "tm_tenant_session";

/**
 * Builds a `Set-Cookie` header value for the tenant-user session cookie. `HttpOnly`, `Secure`
 * omitted only in local development (the same dev-safe pattern already fixed on
 * `platform-auth/cookies.ts` — `Secure` cookies are silently refused by browsers over plain
 * `http://lvh.me:3000`, unlike `localhost`). `SameSite=Strict` — the browser only ever reaches this
 * cookie's issuing endpoint through `apps/web/next.config.ts`'s same-origin `/tenant-api/*` rewrite
 * proxy, so no genuine cross-site request ever happens (mirrors the Super Admin cookie's reasoning).
 * Deliberately **no `Domain` attribute** — host-only scoping means a cookie issued at
 * `acmecorp.tm.com` is never sent to `othertenant.tm.com` by the browser itself, a second,
 * independent layer of tenant isolation alongside the RLS-based session check (research.md §3,
 * plan.md Constraints).
 */
export function serializeTenantUserCookie(value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "development" ? "" : " Secure;";
  return `${TENANT_USER_COOKIE_NAME}=${value}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}
