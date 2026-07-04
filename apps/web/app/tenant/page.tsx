import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import TenantLoginForm from "./tenant-login-form";
import TenantAuthenticatedView from "./tenant-authenticated-view";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

/**
 * Server Component. Reads `x-tenant-subdomain` (set only by middleware.ts, never client-settable —
 * Spec 4) and the `tm_tenant_session` cookie (httpOnly, readable server-side via `cookies()`).
 * Calls apps/api directly, server-to-server (never through the browser-facing `/tenant-api/*`
 * rewrite — that's for client-side fetches only, research.md §4-5 of Spec 4/005).
 *
 * - No session, or session invalid: renders the config-driven login form (only the methods
 *   actually enabled for this tenant — spec FR-007).
 * - Valid session, still must change password: redirects to /set-password (FR-013a).
 * - Valid session, real password set: minimal authenticated confirmation (spec Assumptions — no
 *   full product dashboard, out of scope).
 */
export default async function TenantLandingPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain");

  if (!subdomain) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-primary">Welcome</h1>
        <p className="mt-2 text-sm text-slate-600">Your organization&apos;s workspace is set up.</p>
      </main>
    );
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("tm_tenant_session");

  if (sessionCookie) {
    const meRes = await fetch(
      `${API_ORIGIN}/tenant-auth/me?subdomain=${encodeURIComponent(subdomain)}`,
      { headers: { cookie: `tm_tenant_session=${sessionCookie.value}` }, cache: "no-store" },
    );
    if (meRes.ok) {
      const body = (await meRes.json()) as {
        data: { email: string; mustChangePassword: boolean };
      };
      if (body.data.mustChangePassword) {
        redirect("/set-password");
      }
      return <TenantAuthenticatedView email={body.data.email} subdomain={subdomain} />;
    }
  }

  const resolveRes = await fetch(
    `${API_ORIGIN}/tenant-routing/resolve?subdomain=${encodeURIComponent(subdomain)}`,
    { cache: "no-store" },
  );
  const resolveBody = (await resolveRes.json().catch(() => null)) as {
    data?: { tenantName?: string; enabledAuthMethods?: string[] };
  } | null;

  return (
    <TenantLoginForm
      subdomain={subdomain}
      tenantName={resolveBody?.data?.tenantName ?? subdomain}
      enabledAuthMethods={resolveBody?.data?.enabledAuthMethods ?? []}
    />
  );
}
