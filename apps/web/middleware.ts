import { NextResponse, type NextRequest } from "next/server";

// contracts/nextjs-middleware-routing.md (spec 004). Root-domain-only paths — every existing
// non-tenant top-level route in apps/web/app/ today (spec FR-003, research.md §7). Matched as exact
// leading path segments, never a naive substring/prefix match.
const ROOT_ONLY_PATH_PREFIXES = ["/platform", "/admin", "/provisioning"];

// Tenant Authentication Configuration spec (2026-07-04 follow-up) — every non-excluded request to
// a tenant subdomain otherwise called /tenant-routing/resolve on apps/api, uncached, per request
// (including RSC prefetches). This cookie caches that result for a short, bounded window so repeat
// requests within a session skip the network round trip. Signed with an HMAC so a client-tampered
// cookie is rejected and treated as a cache miss — never trusted as-is — since it's read back to
// make the same suspended/cancelled/not_found routing decisions the live resolve would.
const RESOLVE_CACHE_COOKIE_NAME = "tm_tenant_resolve_cache";
const RESOLVE_CACHE_TTL_SECONDS = 60;

interface ResolveResult {
  state: string;
  tenantName?: string;
}

function matchesRootOnlyPath(pathname: string): boolean {
  return ROOT_ONLY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function notFound(request: NextRequest): NextResponse {
  return NextResponse.rewrite(new URL("/_not-found-trigger", request.url));
}

let hmacKeyPromise: Promise<CryptoKey> | undefined;

// Edge Runtime exposes Web Crypto (`crypto.subtle`), not Node's `node:crypto` module.
function getHmacKey(): Promise<CryptoKey> {
  if (!hmacKeyPromise) {
    const secret =
      process.env.TENANT_RESOLVE_CACHE_SECRET ?? "dev-only-insecure-tenant-resolve-cache-secret";
    hmacKeyPromise = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return hmacKeyPromise;
}

function toBase64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signPayload(payload: string): Promise<string> {
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(signature);
}

async function readResolveCache(
  request: NextRequest,
  label: string,
): Promise<ResolveResult | undefined> {
  const raw = request.cookies.get(RESOLVE_CACHE_COOKIE_NAME)?.value;
  if (!raw) return undefined;

  const separatorIndex = raw.lastIndexOf(".");
  if (separatorIndex === -1) return undefined;
  const payload = raw.slice(0, separatorIndex);
  const signature = raw.slice(separatorIndex + 1);

  // Reject silently (fall through to a live resolve) on any mismatch — a tampered, stale-secret, or
  // malformed cookie must never be trusted, only treated as a cache miss.
  if (signature !== (await signPayload(payload))) return undefined;

  const [cachedLabel, state, encodedTenantName, expiresAtRaw] = payload.split("|");
  const expiresAt = Number(expiresAtRaw);
  if (!cachedLabel || !state || !expiresAtRaw || Number.isNaN(expiresAt)) return undefined;
  if (cachedLabel !== label) return undefined; // defense-in-depth; host-only cookie scoping already isolates this per-subdomain
  if (expiresAt <= Date.now()) return undefined;

  return { state, tenantName: encodedTenantName ? decodeURIComponent(encodedTenantName) : undefined };
}

async function writeResolveCache(
  response: NextResponse,
  label: string,
  result: ResolveResult,
): Promise<void> {
  const expiresAt = Date.now() + RESOLVE_CACHE_TTL_SECONDS * 1000;
  const payload = `${label}|${result.state}|${encodeURIComponent(result.tenantName ?? "")}|${expiresAt}`;
  const signature = await signPayload(payload);
  response.cookies.set(RESOLVE_CACHE_COOKIE_NAME, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: "strict",
    // Same dev-safe pattern as the session cookies (platform-auth/cookies.ts, tenant-auth/cookies.ts)
    // — lvh.me over plain HTTP isn't a secure context, so browsers silently drop `Secure` cookies there.
    secure: process.env.NODE_ENV !== "development",
    path: "/",
    maxAge: RESOLVE_CACHE_TTL_SECONDS,
  });
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

  // /tenant-api/* and /platform-api/* are next.config.ts's own browser-facing rewrite proxies
  // (Tenant Authentication Configuration / Super Admin Authentication specs) — pass through
  // untouched, never rewritten here. Those routes already receive `subdomain` as an explicit query
  // param from the client (research.md §4 addendum) and independently re-resolve it server-side;
  // they don't need this middleware's `x-tenant-subdomain` header at all. Critically,
  // `NextResponse.rewrite(..., { request: { headers } })` does not reliably preserve a POST body —
  // confirmed via real-browser testing (login silently received an empty body through this path) —
  // so these proxy paths must never go through the rewrite branches below.
  if (pathname.startsWith("/tenant-api/") || pathname.startsWith("/platform-api/")) {
    return NextResponse.next();
  }

  if (matchesRootOnlyPath(pathname)) {
    // /platform, /admin, /provisioning are root-domain-only — never reachable via a tenant
    // subdomain (spec FR-003).
    return notFound(request);
  }

  const cached = await readResolveCache(request, label);
  let data: ResolveResult;

  if (cached) {
    data = cached;
  } else {
    const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3001";
    try {
      const res = await fetch(
        `${apiOrigin}/tenant-routing/resolve?subdomain=${encodeURIComponent(label)}`,
      );
      const body = (await res.json()) as { success: boolean; data?: ResolveResult };
      if (!body.data) {
        // Fastify reachable but returned no data — fail closed (spec FR-007).
        return notFound(request);
      }
      data = body.data;
    } catch {
      // Fastify unreachable — fail closed, never fall back to a default tenant (spec FR-007).
      return notFound(request);
    }
  }

  let response: NextResponse;
  switch (data.state) {
    case "reserved":
    case "not_found":
      response = notFound(request);
      break;

    case "suspended":
    case "cancelled": {
      // Forwarded as REQUEST headers (via the `request.headers` rewrite option), not response
      // headers — so the destination page's Server Component can read them via next/headers().
      const requestHeaders = new Headers(request.headers);
      if (data.tenantName) {
        requestHeaders.set("x-tenant-name", data.tenantName);
      }
      const statusUrl = request.nextUrl.clone();
      statusUrl.pathname = `/tenant-status/${data.state}`;
      response = NextResponse.rewrite(statusUrl, { request: { headers: requestHeaders } });
      break;
    }

    case "valid": {
      // `request.nextUrl.clone()` preserves the original query string (e.g. reset-password's
      // `?token=...`) — constructing a fresh `new URL(pathname, request.url)` instead silently
      // drops it, since a path-absolute reference replaces the entire path+query+hash of the base
      // (confirmed via real-browser testing: `searchParams` resolved to `{}` server-side despite
      // the browser's address bar clearly showing the token).
      const targetUrl = request.nextUrl.clone();
      if (pathname === "/") {
        targetUrl.pathname = "/tenant";
      }
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-tenant-subdomain", label);
      response = NextResponse.rewrite(targetUrl, { request: { headers: requestHeaders } });
      break;
    }

    default:
      response = notFound(request);
  }

  // Only a fresh (uncached) resolve needs to (re-)populate the cache — a cache hit is already
  // covered by its own still-valid expiry.
  if (!cached) {
    await writeResolveCache(response, label, data);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)"],
};
