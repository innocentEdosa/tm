# Contract: Next.js Middleware Routing Behavior

`apps/web/middleware.ts` — the Next.js middleware boundary (spec FR-002), running before any page or
route handler, on every request. This is not an HTTP API in the traditional sense, but it is the
interface boundary between "what the browser asked for" and "what Next.js serves," so its behavior is
documented here as a contract, the same way `apps/web/next.config.ts`'s rewrite proxy is documented in
code comments today.

## Configuration

| Env var | Where read | Local dev value | Production value |
|---|---|---|---|
| `ROOT_DOMAIN` | `apps/web/middleware.ts` (new) | `lvh.me` | `tm.com` |
| `API_ORIGIN` | `apps/web/middleware.ts` (new use of the existing var; already read by `next.config.ts`) | `http://localhost:3001` | The deployed `apps/api` origin |

`ROOT_DOMAIN` never includes a port — the port is stripped from the incoming `Host` header before
comparison (spec Edge Cases: `acmecorp.lvh.me:3000` must resolve the same way `acmecorp.tm.com` does).

## Decision table

Given `Host` (port stripped, lowercased) and `ROOT_DOMAIN`:

| Host shape | Path | Result |
|---|---|---|
| `ROOT_DOMAIN` or `www.ROOT_DOMAIN` | any | Pass through unmodified — marketing page, `/platform/login`, `/admin/*`, `/provisioning/*` all serve normally (spec FR-001, US2 Acceptance Scenario 1–2) |
| `{label}.ROOT_DOMAIN` (exactly one label) | `/platform*`, `/admin*`, `/provisioning*` | **404** — root-domain-only path on a tenant subdomain (spec FR-003, research.md §7) |
| `{label}.ROOT_DOMAIN`, `{label}` on `RESERVED_SUBDOMAINS` | any (not already root/`www`) | **404** — reserved, resolved without a Fastify call for words middleware itself recognizes as reserved; otherwise via the resolve endpoint's `reserved` state (spec FR-006) |
| `{label}.ROOT_DOMAIN`, other path | any | Call `GET {API_ORIGIN}/tenant-routing/resolve?subdomain={label}` (contracts/tenant-routing-resolve-api.md) and branch on `state`: |
| ↳ `state: "not_found"` | | **404** (spec FR-007) |
| ↳ `state: "suspended"` \| `"cancelled"` | | Rewrite to `/tenant-status/{state}` (preserves the visible URL; spec FR-008), passing `tenantName` via a request header |
| ↳ `state: "valid"` | | Set `x-tenant-subdomain: {label}` request header; rewrite `/` to `/tenant` (placeholder landing, spec Assumptions); other paths pass through as-is (no tenant app exists yet — will 404 via Next.js's own routing, since no page matches) |
| Host has more than one label before `ROOT_DOMAIN` (e.g. `foo.acmecorp.ROOT_DOMAIN`) | any | **404** — invalid, never matched to a tenant (spec FR-013, Edge Cases) |
| Host is missing, malformed, or matches neither shape above | any | **404** — invalid (spec Edge Cases) |

## Headers this middleware sets (never accepts from the client)

| Header | Set when | Purpose |
|---|---|---|
| `x-tenant-subdomain` | Host resolves to a `valid` tenant subdomain | Carries the raw subdomain string (never a tenant_id, research.md §4) to the tenant landing Server Component and, later, to the future tenant-auth spec's FR-012 consistency check. Any identically-named header on the *incoming* request is stripped/overwritten by middleware before forwarding — it is never client-settable. |

## Explicitly not part of this contract

- Custom domains per tenant (out of scope, spec Out of Scope).
- Any behavior for authenticated tenant-user requests beyond header-forwarding — the actual FR-012
  session/subdomain comparison is wired in by the future tenant-user-authentication spec
  (research.md §8, plan.md Complexity Tracking).
- Caching of the resolve call — every request to a candidate tenant subdomain calls the resolve
  endpoint fresh (plan.md Technical Context, Performance Goals).
