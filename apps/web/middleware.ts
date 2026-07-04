import { NextResponse, type NextRequest } from "next/server";

// contracts/nextjs-middleware-routing.md (spec 004). Root-domain-only paths — every existing
// non-tenant top-level route in apps/web/app/ today (spec FR-003, research.md §7). Matched as exact
// leading path segments, never a naive substring/prefix match.
const ROOT_ONLY_PATH_PREFIXES = ["/platform", "/admin", "/provisioning"];

function matchesRootOnlyPath(pathname: string): boolean {
  return ROOT_ONLY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function notFound(request: NextRequest): NextResponse {
  return NextResponse.rewrite(new URL("/_not-found-trigger", request.url));
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const rootDomain = process.env.ROOT_DOMAIN ?? "tm.com";
  const hostHeader = request.headers.get("host") ?? "";
  const host = hostHeader.split(":")[0].toLowerCase();

  // Root domain (bare or www.) — marketing page and all root-only paths serve unmodified, no
  // tenant lookup, no auth context (spec FR-001).
  if (host === rootDomain || host === `www.${rootDomain}`) {
    return NextResponse.next();
  }

  const suffix = `.${rootDomain}`;
  if (!host.endsWith(suffix)) {
    // Host matches neither the root domain nor any subdomain of it — invalid (spec Edge Cases).
    return notFound(request);
  }

  const label = host.slice(0, -suffix.length);
  if (label === "" || label.includes(".")) {
    // Missing label, or more than one label before the root domain (e.g. foo.acmecorp.tm.com) —
    // invalid, never matched to a tenant (spec FR-013, Edge Cases).
    return notFound(request);
  }

  const { pathname } = request.nextUrl;
  if (matchesRootOnlyPath(pathname)) {
    // /platform, /admin, /provisioning are root-domain-only — never reachable via a tenant
    // subdomain (spec FR-003).
    return notFound(request);
  }

  const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3001";
  let data: { state: string; tenantName?: string } | undefined;
  try {
    const res = await fetch(
      `${apiOrigin}/tenant-routing/resolve?subdomain=${encodeURIComponent(label)}`,
    );
    const body = (await res.json()) as { success: boolean; data?: typeof data };
    data = body.data;
  } catch {
    // Fastify unreachable — fail closed, never fall back to a default tenant (spec FR-007).
    return notFound(request);
  }

  if (!data) {
    return notFound(request);
  }

  switch (data.state) {
    case "reserved":
    case "not_found":
      return notFound(request);

    case "suspended":
    case "cancelled": {
      // Forwarded as REQUEST headers (via the `request.headers` rewrite option), not response
      // headers — so the destination page's Server Component can read them via next/headers().
      const requestHeaders = new Headers(request.headers);
      if (data.tenantName) {
        requestHeaders.set("x-tenant-name", data.tenantName);
      }
      return NextResponse.rewrite(new URL(`/tenant-status/${data.state}`, request.url), {
        request: { headers: requestHeaders },
      });
    }

    case "valid": {
      const target = pathname === "/" ? "/tenant" : pathname;
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-tenant-subdomain", label);
      return NextResponse.rewrite(new URL(target, request.url), {
        request: { headers: requestHeaders },
      });
    }

    default:
      return notFound(request);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)"],
};
