# Contract: Tenant Routing Resolve Endpoint

A single Fastify JSON endpoint, `apps/api/src/tenant-routing/tenant-routing-routes.ts`, backing this
spec's subdomain resolution (FR-004, FR-006–FR-009). Unlike every other route family in this codebase,
it is not intended to be called by a browser at all — it is called server-to-server, once per request,
by `apps/web/middleware.ts` (research.md §5). It requires no session/cookie of any kind: the decision
it returns is not sensitive beyond what visiting the subdomain directly already reveals.

## `GET /tenant-routing/resolve`

**Query parameters**:

| Param | Required | Notes |
|---|---|---|
| `subdomain` | Yes | The raw candidate label extracted from the `Host` header by middleware — lowercased and single-label already (contracts/nextjs-middleware-routing.md). Server-side re-lowercases and re-validates the shape defensively; never trusts the caller's normalization. |

**Response `200`** — `reserved` or `not_found` (spec FR-006, FR-007):
```json
{ "success": true, "data": { "state": "reserved" } }
```
```json
{ "success": true, "data": { "state": "not_found" } }
```

**Response `200`** — `suspended` or `cancelled` (spec FR-008):
```json
{ "success": true, "data": { "state": "suspended", "tenantName": "Acme Corp" } }
```

**Response `200`** — `valid` (spec FR-009):
```json
{ "success": true, "data": { "state": "valid", "tenantName": "Acme Corp" } }
```

Note what is **never** in any response: a `tenant_id`. Only a display name for the placeholder page
and status pages is returned (data-model.md, research.md §4) — Next.js has no way to smuggle a
tenant_id further downstream even by accident, and any future consumer needing an actual tenant_id
must independently resolve one via its own verified path (spec FR-010).

**Response `400`** — `subdomain` query param missing or shaped invalidly (e.g. contains a dot, meaning
middleware should have already rejected it as multi-label — belt-and-suspenders, not expected in
normal operation):
```json
{ "success": false, "message": "Invalid subdomain" }
```

## Explicitly not part of this contract

- No authentication/session is required or checked — this endpoint's response is not
  tenant-confidential data (spec Constitution Alignment).
- No endpoint here creates, updates, or deletes a `tenants` row — this is read-only, backed solely by
  the `SELECT`-only `tenant_subdomain_lookup` RLS policy (data-model.md).
- This endpoint is not exposed through `apps/web/next.config.ts`'s `/platform-api/*` browser-facing
  rewrite proxy — it is reached directly at `API_ORIGIN` from `apps/web/middleware.ts`'s server-side
  execution only (research.md §5).
