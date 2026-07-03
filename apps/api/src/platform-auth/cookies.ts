/**
 * Hand-rolled cookie helpers (research.md §1) — deliberately narrow: this project only ever needs
 * to read/write one self-generated, hex-encoded session token value, not parse arbitrary
 * third-party cookie headers with quoting/escaping edge cases, which is what a general-purpose
 * cookie library earns its keep on.
 */

export const SUPER_ADMIN_COOKIE_NAME = "tm_super_admin_session";

/** Reads one named value out of a raw `Cookie` request header (e.g. `"a=1; b=2"`). */
export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      return trimmed.slice(eq + 1);
    }
  }
  return undefined;
}

/**
 * Builds a `Set-Cookie` header value for the Super Admin session cookie: `HttpOnly` (never
 * readable by client-side JS), `Secure` (HTTPS-only — modern browsers treat `localhost` as a
 * secure context too, so this is safe to set unconditionally). `Path=/` —
 * `requireSuperAdminSession` guards routes across three different prefixes (`/platform/*`,
 * `/admin/*`, `/provisioning/*`), so a narrower `Path` would silently stop the browser from sending
 * the cookie to any prefix not explicitly covered.
 *
 * `SameSite=Strict`: `apps/web` and `apps/api` are two different origins — different ports
 * locally, different domains in production (Vercel vs. Railway). Two prior attempts got this
 * wrong in opposite directions, both caught by manual browser verification, neither by the
 * automated test suite (Fastify's `.inject()` doesn't model cookie `SameSite`/third-party
 * enforcement at all):
 * 1. `SameSite=Strict` first — silently broke every follow-up request, since `Strict`/`Lax` both
 *    withhold cookies on cross-site fetch/XHR requests.
 * 2. `SameSite=None; Secure` next — technically the correct value for a genuinely cross-site
 *    cookie, but Chrome (and other browsers rolling out the same default) treats `SameSite=None`
 *    cookies set by a different registrable domain than the top-level page as third-party cookies
 *    and withholds them by default regardless of `SameSite`, so this still failed.
 *
 * The actual fix was architectural, not a cookie attribute: `apps/web/next.config.ts` now proxies
 * browser requests to apps/api through apps/web's own origin (`rewrites()`,
 * `/platform-api/* → API_ORIGIN/*`), so from the browser's point of view this cookie is always
 * same-origin — no cross-site request ever happens. That makes `SameSite=Strict` both correct and
 * the most secure choice (no legitimate cross-site use case remains, and it hardens against CSRF
 * that `None` would have left as a residual, accepted gap). `maxAgeSeconds: 0` clears the cookie
 * (used on logout).
 */
export function serializeSuperAdminCookie(value: string, maxAgeSeconds: number): string {
  return `${SUPER_ADMIN_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}
