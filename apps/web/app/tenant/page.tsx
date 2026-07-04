import { headers } from "next/headers";

// Server Component — no interactivity needed. Same minimal design posture as every prior UI surface
// (constitution Principle V). Reads x-tenant-subdomain (set only by middleware.ts, never
// client-settable) and re-resolves it server-to-server against apps/api, same pattern as
// middleware.ts itself (research.md §5) — never a direct browser fetch, so no cookie/cross-origin
// concern applies here.
//
// This is a minimal placeholder confirming successful tenant resolution (spec Assumptions) —
// tenant-user authentication doesn't exist yet; a future spec replaces this with the real
// tenant-user login/app experience without changing the routing rules this feature establishes.
export default async function TenantLandingPage() {
  const headerList = await headers();
  const subdomain = headerList.get("x-tenant-subdomain");

  let tenantName = subdomain ?? "your organization";
  if (subdomain) {
    const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3001";
    try {
      const res = await fetch(
        `${apiOrigin}/tenant-routing/resolve?subdomain=${encodeURIComponent(subdomain)}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as { data?: { tenantName?: string } };
      if (body.data?.tenantName) {
        tenantName = body.data.tenantName;
      }
    } catch {
      // Fall back to the raw subdomain label — still a coherent placeholder message.
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">Welcome to {tenantName}</h1>
      <p className="mt-2 text-sm text-gray-600">Your organization&apos;s workspace is set up.</p>
    </main>
  );
}
