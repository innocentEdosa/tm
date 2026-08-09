import type { NextConfig } from "next";
import path from "node:path";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  output: "standalone",
  // Lets next/image optimize presigned R2 download/thumbnail URLs (course images, existing-file
  // picker thumbnails) instead of falling back to a plain `<img>`. Wildcarded rather than pinned to
  // one account/bucket — R2's domain suffix is fixed across every Cloudflare account, but the
  // account-id/bucket-name subdomain prefix (`R2_ACCOUNT_ID`/`R2_BUCKET_NAME`) varies per environment
  // (dev/staging/production). The URL's query string (presigned signature/expiry) is irrelevant to
  // this match — only scheme+hostname are checked.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.r2.cloudflarestorage.com" }],
  },
  // Next infers the monorepo root by walking up for lockfiles; this repo also has a stray lockfile
  // one level above the actual workspace root (pnpm-workspace.yaml lives here), which made Next guess
  // wrong and warn on every build. Pinning it explicitly also keeps `output: "standalone"`'s file
  // tracing (used by apps/web/Dockerfile, docker-compose.prod.yml) from over-including files outside
  // this workspace.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@tm/ui"],
  // Proxies browser requests to apps/api through this app's own origin, so the Super Admin
  // session cookie (apps/api's Set-Cookie response) is set by, and only ever sent back to, this
  // same origin — not a cross-site one. apps/web and apps/api are two different origins/domains
  // (different ports locally, Vercel vs. Railway in production); without this proxy, the cookie
  // is a third-party cookie from the browser's point of view and Chrome (and other browsers
  // rolling out the same default) withholds it regardless of SameSite — found via real-browser
  // verification, not by the automated test suite (Fastify's `.inject()` doesn't model this at
  // all). Client code must fetch relative paths under `/platform-api/*`, never `API_ORIGIN`
  // directly — see `apps/web/app/platform/login/page.tsx` etc. Same reasoning applies to the
  // tenant-user session cookie (Tenant Authentication Configuration spec) — `/tenant-api/*` proxies
  // to the same API_ORIGIN, keeping that cookie same-origin too.
  async rewrites() {
    return [
      { source: "/platform-api/:path*", destination: `${API_ORIGIN}/:path*` },
      { source: "/tenant-api/:path*", destination: `${API_ORIGIN}/:path*` },
    ];
  },
  // Training Request Rename (spec 020) — the feature moved from /learning/tna to
  // /learning/training-requests; this keeps any bookmarked or shared link to the old path working
  // (spec FR-006).
  async redirects() {
    return [
      { source: "/learning/tna/:path*", destination: "/learning/training-requests/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
