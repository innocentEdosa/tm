# Feature Specification: Domain-Based Tenant Routing

**Feature Branch**: `004-tenant-subdomain-routing`

**Created**: 2026-07-03

**Status**: Draft

**Input**: User description: "Build subdomain-based routing so each tenant is accessed via {subdomain}.tm.com, resolves to the correct tenant_id, and sets RLS context accordingly — while keeping the root domain, Super Admin access, and invalid subdomains handled distinctly and safely. Depends on: Tenant Provisioning Core (Spec 2) — subdomains are assigned during provisioning. Super Admin Authentication (Spec 3) — Super Admin login lives at a fixed path on the root domain, not a subdomain. Requirements cover routing rules for the root domain, /platform/login, valid tenant subdomains, reserved subdomains, nonexistent subdomains, and suspended/cancelled tenants; the mechanism for passing resolved tenant context from Next.js to Fastify with independent server-side validation; where app.tenant_id gets set; local development via lvh.me; and wildcard DNS/SSL setup as an explicit prerequisite. Out of scope: custom domains per tenant."

## Clarifications

### Session 2026-07-03

- Q: Is the reserved-subdomain starter list in FR-005 acceptable as the platform's list, or does it
  need edits before Spec 2's provisioning validation is amended to enforce it? → A: Accepted as-is
  (confirmed by stakeholder). No edits requested.
- Q: Should Spec 2's provisioning validation be amended now to enforce this spec's reserved-subdomain
  list at submission time, rather than deferred as follow-up work? → A: Yes — amend Spec 2 now.
  `specs/002-tenant-provisioning-core/spec.md` has been updated (FR-016 added) to require this.
- Q: The `tenants` table already has RLS (`tenant_isolation` policy, keyed on `app.tenant_id`) that
  restricts a connection to its own tenant row — but subdomain resolution is inherently a cross-tenant
  lookup performed *before* any `tenant_id` is known. How does that lookup get authorized under RLS,
  consistent with Spec 3's precedent of extending policies with an explicit allowance clause rather
  than reintroducing a `BYPASSRLS` role? → A: Add a second, `SELECT`-only permissive policy on
  `tenants` gated by a narrow, server-set `app.subdomain_lookup` flag (mirrors `app.is_super_admin`
  from Spec 3) — never touched by `INSERT`/`UPDATE`/`DELETE` (`WITH CHECK` stays governed solely by
  the existing `tenant_isolation` policy). The flag is set only inside a dedicated, narrow pre-auth
  lookup function that selects just `id` and `status`, never contact info, and never sets
  `app.tenant_id`. See FR-015.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Tenant User Reaches Their Own Organization (Priority: P1)

An employee, manager, or HR admin at a client company types `acmecorp.tm.com` into their browser (or
clicks a bookmarked link) and expects to land in their own company's space — not anyone else's, and
not a generic error.

**Why this priority**: This is the entire point of the feature. Without correct, verified resolution
of subdomain → tenant, none of the platform's tenant-scoped functionality (built in other specs) is
reachable at all.

**Independent Test**: Provision a tenant with subdomain `acmecorp` (via the existing provisioning
flow), visit `acmecorp.tm.com` (or `acmecorp.lvh.me:3000` locally), and confirm the response is
specific to that tenant (e.g. shows the tenant's name) and not to any other tenant.

**Acceptance Scenarios**:

1. **Given** a tenant record exists with subdomain `acmecorp` and status Trial or Active, **When** a
   request arrives with Host `acmecorp.tm.com`, **Then** the system resolves the subdomain to that
   tenant's internal `tenant_id` via a verified lookup and proceeds with that tenant's context.
2. **Given** two tenants exist with subdomains `acmecorp` and `globex`, **When** a request arrives for
   `acmecorp.tm.com`, **Then** the response never contains `globex`'s data or identity under any
   circumstance.

---

### User Story 2 - Root Domain and Super Admin Login Stay Isolated From Tenant Subdomains (Priority: P1)

A visitor browsing `tm.com` sees the marketing site, and a platform operator logs in at
`tm.com/platform/login`. Neither of these must ever be reachable from, or leak into, a tenant's
subdomain — a tenant subdomain is a different security boundary entirely.

**Why this priority**: This is a security boundary, not a convenience feature. If `/platform/login`
(or any part of it) were reachable via a tenant subdomain, it would blur the isolation between
platform-operator authentication (Spec 3) and tenant-scoped context that this spec is responsible for
maintaining. It must hold from day one, at the same priority as tenant resolution itself.

**Independent Test**: Visit `tm.com` and confirm the marketing page renders with no tenant/auth
context. Separately, visit `acmecorp.tm.com/platform/login` and confirm it does **not** render the
Super Admin login form — it returns a 404, exactly as if that path did not exist for that host.

**Acceptance Scenarios**:

1. **Given** a request with Host `tm.com` (or `www.tm.com`) and no subdomain, **When** the request is
   for `/`, **Then** the marketing/landing page renders with no tenant lookup performed and no
   authentication context applied.
2. **Given** a request with Host `tm.com`, **When** the request is for `/platform/login`, **Then** the
   Super Admin login page renders normally (per Spec 3).
3. **Given** a request with Host `acmecorp.tm.com` (any valid tenant subdomain), **When** the request
   is for `/platform/login` or any other root-domain-only path, **Then** the system returns a clean
   404 — never the Super Admin login form, and never a silent redirect to the root domain.

---

### User Story 3 - An Unclaimed Subdomain Shows a Clean 404 (Priority: P2)

Someone guesses at, mistypes, or probes a subdomain that no tenant has ever claimed (e.g.
`doesnotexist.tm.com`).

**Why this priority**: Falling back to a default tenant or silently redirecting on an unrecognized
subdomain would be confusing at best and a data-exposure risk at worst. This must be correct, but it
is one layer below the core resolution and isolation stories.

**Independent Test**: Visit a subdomain with no matching tenant record and confirm a clean 404 page
renders — no default tenant content, no redirect to root, no login form.

**Acceptance Scenarios**:

1. **Given** no tenant record exists with a given subdomain, and that subdomain is not on the reserved
   list, **When** a request arrives for that Host, **Then** the system returns a clean 404 response.

---

### User Story 4 - A Suspended or Cancelled Tenant's Subdomain Shows Its Own Status Page (Priority: P2)

A client company whose account has lapsed into Suspended or Cancelled status (billing failure,
contract end, manual suspension) visits their own subdomain and needs to understand *why* they can't
get in — not see a generic 404 (which reads as "this was never a real address") or a login form that
silently fails.

**Why this priority**: This is a customer-communication problem as much as a routing one — a wrong
answer here (404) reads as if the company's account never existed, which is confusing and reflects
badly on the platform's reliability.

**Independent Test**: Set a provisioned tenant's status to Suspended (or Cancelled), visit that
tenant's subdomain, and confirm a distinct status page renders identifying the account state — not a
404, not a login form.

**Acceptance Scenarios**:

1. **Given** a tenant record exists with subdomain `acmecorp` and status Suspended, **When** a request
   arrives with Host `acmecorp.tm.com`, **Then** the system renders a distinct "this account is
   suspended" page.
2. **Given** the same tenant instead has status Cancelled, **When** the same request arrives, **Then**
   the system renders a distinct "this account is cancelled" page (or an equivalent status-specific
   message), not the Suspended message and not a 404.

---

### User Story 5 - Reserved Words Can Never Become a Tenant's Subdomain (Priority: P3)

The platform reserves certain subdomain labels (`www`, `api`, `app`, `admin`, `mail`, etc.) for its own
infrastructure and future use. No tenant — during provisioning (Spec 2) or by any other path — can end
up owning one of these, and even if one were somehow assigned, it must never resolve as a tenant via
routing.

**Why this priority**: Defense in depth. Spec 2 is expected to block this at assignment time, so the
routing layer should rarely see a reserved word in practice — but routing must not blindly trust that
provisioning-side validation was never bypassed.

**Independent Test**: Attempt to provision a tenant with subdomain `admin`; confirm provisioning
rejects it. Separately, confirm a direct request to `admin.tm.com` never resolves to a tenant lookup
result, regardless of what (if anything) exists in the tenants table.

**Acceptance Scenarios**:

1. **Given** the reserved-word list includes `admin`, **When** a request arrives with Host
   `admin.tm.com`, **Then** the system does not attempt a tenant lookup for `admin` and instead treats
   it as reserved (404, distinct from an ordinary unclaimed subdomain only in that it is fixed and
   permanent, never claimable).

---

### Edge Cases

- Host header casing varies (`ACMECorp.TM.COM`) — subdomain matching MUST be case-insensitive.
- A request Host contains more than one label before the root domain (e.g.
  `foo.acmecorp.tm.com`) — MUST be treated as invalid (404), not matched to `acmecorp`.
- A request Host is missing, malformed, or matches neither the bare root domain nor a single-label
  subdomain of it — MUST be treated as invalid (404), never fall through to the marketing page or any
  tenant.
- `www.tm.com` — MUST behave identically to the bare root domain (marketing page), not be treated as
  an unclaimed-subdomain 404, even though `www` is also on the reserved list for provisioning
  purposes.
- A tenant is suspended *while a user is mid-session* on their subdomain — the very next request on
  that subdomain MUST reflect the new status (suspended page), not continue serving normal tenant
  context from a stale check.
- An authenticated tenant user's session belongs to a different tenant than the one resolved from the
  current subdomain (e.g. a stale session cookie reused across two tenant subdomains in the same
  browser profile) — MUST be rejected, never silently served under either tenant's identity.
- Local dev Host is `acmecorp.lvh.me:3000` — the port and `lvh.me` suffix MUST be handled the same way
  `tm.com` is in production; the matching logic must not be hardcoded to the production domain string
  in more than one place.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST serve the marketing/landing page for the bare root domain and for
  `www.<root domain>`, performing no tenant lookup and applying no authentication context.
- **FR-002**: System MUST extract the subdomain label from the Host header before the request reaches
  page or route logic, so that every downstream handler already knows whether the request is
  root-domain, a candidate tenant subdomain, or invalid.
- **FR-003**: System MUST treat `/platform/login` and any other root-domain-only paths as reachable
  only when the Host resolves to the root domain; any request to those paths on a tenant-subdomain
  Host MUST return a clean 404, with no redirect to the root domain and no partial rendering of the
  Super Admin login form.
- **FR-004**: System MUST resolve a candidate subdomain to a tenant's internal identifier via a
  server-side, verified lookup against the tenant records established in Spec 2 — the subdomain string
  from the Host header MUST NOT be trusted directly as, or converted directly into, a tenant
  identifier.
- **FR-005**: System MUST maintain a single, explicit reserved-subdomain list (starting set: `www`,
  `api`, `app`, `admin`, `mail`, `ftp`, `smtp`, `imap`, `pop`, `ns1`, `ns2`, `static`, `cdn`, `assets`,
  `help`, `support`, `status`, `docs`, `blog`, `dev`, `staging`, `test`, `platform`, `portal`,
  `dashboard`, `login`, `auth`, `billing`, `security`, `webmail`) that is consulted both by
  provisioning (Spec 2, at subdomain-assignment time) and by tenant routing (this spec, at
  request-resolution time), so the two never drift apart into two different lists.
- **FR-006**: System MUST NOT perform a tenant lookup for any Host whose subdomain label is on the
  reserved list — a reserved label is never eligible to resolve to a tenant, regardless of what (if
  anything) exists in the tenant records.
- **FR-007**: System MUST return a clean 404 for any subdomain that does not match a reserved word and
  does not match any existing tenant record — with no fallback to a default tenant and no redirect.
- **FR-008**: System MUST render a distinct, status-specific page (not a 404, not a login form) when a
  request resolves to a tenant whose status is Suspended or Cancelled, identifying that the account is
  suspended or cancelled respectively.
- **FR-009**: System MUST proceed to normal tenant-scoped routing only when the resolved tenant's
  status is Trial or Active.
- **FR-010**: The mechanism that carries the resolved subdomain (or tenant identifier) from Next.js to
  the Fastify API MUST be independently re-validated by Fastify via its own tenant lookup — Fastify
  MUST NOT treat a value received from Next.js (via header or otherwise) as authoritative proof of
  tenant identity on its own.
- **FR-011**: `app.tenant_id` (the Postgres session variable that RLS policies key on) MUST continue to
  be set only from an authenticated session's server-verified `tenant_id` (the existing mechanism), and
  MUST NOT be set, or influenced, directly from a subdomain string or an unvalidated header — subdomain
  resolution governs pre-authentication routing and page selection, never RLS scoping directly.
- **FR-012**: System MUST reject a request where an authenticated tenant user's session `tenant_id`
  does not match the `tenant_id` resolved from the current request's subdomain, rather than silently
  serving data under either tenant's identity.
- **FR-013**: Subdomain matching MUST be case-insensitive and MUST reject any Host with more than one
  label preceding the root domain (e.g. `foo.acmecorp.tm.com`) as invalid.
- **FR-014**: All routing rules in this spec (root domain, `/platform/login` isolation, valid/invalid/
  reserved/suspended subdomain handling) MUST behave identically when the configured root domain is
  `lvh.me:3000` (local development) as when it is the production root domain — differing only in which
  root-domain value is configured for the environment, never in the matching logic itself.
- **FR-015**: The subdomain-to-tenant lookup (FR-004) MUST be authorized under the `tenants` table's
  existing row-level security by extending its policy set with a second, `SELECT`-only permissive
  policy gated on a narrow, server-set session flag (e.g. `app.subdomain_lookup`) — set only by a
  dedicated, pre-authentication lookup code path, never derived from client input — rather than by a
  `BYPASSRLS` role. This lookup MUST NOT set, or otherwise influence, `app.tenant_id`, and MUST select
  only the columns needed to route (tenant identifier and status) — never contact info or other
  tenant-owned data.

### Where `app.tenant_id` Gets Set — Full Request Lifecycle

1. **Pre-authentication (this spec)**: Next.js middleware extracts the subdomain from the Host header
   and calls a dedicated, unauthenticated Fastify lookup endpoint (server-to-server, never a direct
   Next.js-to-Postgres query — consistent with the fixed Next.js/Fastify stack, Principle XI). That
   endpoint runs entirely under the narrow `app.subdomain_lookup`-gated policy from FR-015 and returns
   only whether the subdomain exists and its status — never setting `app.tenant_id`.
2. **Authentication (existing mechanism, unchanged)**: Once a tenant user authenticates, their verified
   `tenant_id` is attached to `request.user` by the (future) tenant-auth mechanism.
3. **Per authenticated request (existing mechanism, unchanged)**: `apps/api/src/plugins/
   tenant-context.ts` sets `app.tenant_id` via `SET LOCAL`, sourced only from `request.user.tenantId` —
   never from the subdomain, a header, or this spec's lookup result.
4. **Consistency check (FR-012, new in this spec)**: if the authenticated request's `request.user.
   tenantId` does not match the `tenant_id` resolved from the current subdomain in step 1, the request
   is rejected before step 3's transaction is used for any tenant-scoped query.

### Key Entities

- **Tenant** (established in Spec 2): consulted here by `subdomain` and `status` to resolve routing —
  no new attributes required by this spec beyond what Spec 2 already defines.
- **Reserved Subdomain List**: a fixed, platform-wide set of subdomain labels no tenant may ever claim
  (via provisioning) or have resolved as a tenant (via routing). Not tenant-configurable, not
  per-tenant data — a single shared list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests to a valid, active tenant's subdomain resolve to that tenant's own
  context, with 0% of requests ever surfacing another tenant's identity or data.
- **SC-002**: 100% of requests to an unclaimed, non-reserved subdomain receive a clean not-found
  response — 0% fall back to a default tenant or redirect silently elsewhere.
- **SC-003**: 100% of requests to a suspended or cancelled tenant's subdomain receive the distinct
  status page — 0% receive a generic 404 or a functioning login form.
- **SC-004**: `/platform/login` (and other root-domain-only paths) is reachable from a tenant subdomain
  Host 0% of the time, across every existing and future tenant subdomain.
- **SC-005**: A developer can exercise every routing outcome described in this spec (valid tenant,
  root domain, `/platform/login`, unclaimed subdomain, suspended/cancelled tenant) in local development
  using `lvh.me` with zero local DNS or hosts-file edits.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema w/ RLS. `app.tenant_id` continues to be set only
  from the authenticated session's verified `tenant_id` (per `apps/api/src/plugins/tenant-context.ts`),
  never from subdomain or header data (FR-011) — this feature does not change that. It does add one
  new RLS surface: a second, `SELECT`-only permissive policy on `tenants` (alongside the existing
  `tenant_isolation` policy from `apps/api/drizzle/0009_rls_tenants.sql`), gated by a narrow server-set
  `app.subdomain_lookup` flag, authorizing the pre-auth cross-tenant subdomain lookup this feature
  requires (FR-015) — following Spec 3's precedent of an explicit policy allowance clause rather than a
  `BYPASSRLS` role.
- **Tenant-configurable vs. fixed platform-wide**: The reserved-subdomain list, the marketing page, and
  the Super Admin login path are all intentionally fixed platform-wide — not tenant-configurable —
  because they are security/identity boundaries that exist outside any single tenant's context. A
  tenant's own `subdomain` value remains tenant-specific data (assigned once at provisioning, per Spec
  2), but the *rules for interpreting* subdomains are shared platform logic.
- **AI-generation review/approval step**: N/A — no AI-generated content in this feature.
- **Kirkpatrick L4/L5 data source & formula**: N/A — not applicable to this feature.
- **Downgrade/cancellation behavior**: This is the first feature where a tenant's Suspended/Cancelled
  status becomes user-visible: visiting a suspended or cancelled tenant's subdomain now shows a
  distinct status page (FR-008/FR-009, US4). The transition logic that actually moves a tenant into
  those statuses remains out of scope (per Spec 2) — this feature only defines what routing does once
  a tenant is already in one of those states.
- **Design system reference**: The marketing/landing page (already stubbed at `apps/web/app/page.tsx`
  using `@tm/ui`), the 404 page, and the suspended/cancelled status page are new or updated UI
  surfaces. They MUST be built against the established design system (Principle V); since the status
  and 404 pages are new surface types not yet designed, building them should explicitly invoke the
  design system work rather than improvising ad hoc styling.
- **Demoable vs. internal**: **Demoable.** Demo flow: (1) visit the root domain — see the marketing
  page; (2) visit `/platform/login` on the root domain — see the Super Admin login, per Spec 3;
  (3) provision a tenant (Spec 2) with a chosen subdomain and visit `{subdomain}.tm.com` (or
  `.lvh.me:3000` locally) — see that tenant's own resolved context; (4) visit a made-up subdomain —
  see a clean 404; (5) mark a provisioned tenant Suspended and revisit its subdomain — see the distinct
  suspended-account page; (6) visit `{tenant-subdomain}.tm.com/platform/login` — see a 404, confirming
  the Super Admin path never leaks into tenant subdomains. Steps 1–4 and 6 require no production DNS
  and can be fully demoed locally via `lvh.me`; step 3/5 depend on wildcard DNS/SSL (see Assumptions)
  only for a *production*, non-`lvh.me` demo.

## Assumptions

- Root domain is `tm.com` in production and `lvh.me:3000` in local development; both are matched by a
  single configured root-domain value per environment, not hardcoded in more than one place (FR-014).
- `www.<root domain>` is treated identically to the bare root domain for serving purposes (marketing
  page), while still appearing on the reserved-subdomain list so no tenant can ever claim `www` as
  their own subdomain.
- The reserved-subdomain starter list is the one enumerated in FR-005. It is expected to grow over
  time (e.g. new platform subsystems); adding to it is a shared-platform config/code change reviewed
  like any other code change, not a per-tenant setting.
- This spec depends on, and requires a follow-up change to, Spec 2's provisioning validation
  (`apps/api/src/provisioning/provision-tenant.ts`) so subdomain assignment is checked against the
  reserved-subdomain list at submission time (FR-005) — that validation did not exist when Spec 2
  shipped and is in scope for this feature's implementation even though the file was created under
  Spec 2.
- For this spec, a valid + active tenant subdomain's landing destination is a minimal page confirming
  successful tenant resolution (e.g. the tenant's name), since tenant-user authentication itself has
  not yet been built as its own spec — this mirrors the minimal-confirmation-screen precedent
  established in Spec 3 for Super Admin login. A future spec is expected to replace this with the real
  tenant-user login/app experience without changing the routing rules established here.
- Hosting is on Vercel (confirmed via `apps/web/.vercel/project.json`). Adding the wildcard domain
  (`*.tm.com`) to the Vercel project and pointing DNS at Vercel is an explicit, not-yet-done setup task
  and a prerequisite for this feature to function outside local development; Vercel provisions SSL
  certificates for wildcard domains automatically once configured, but this must be confirmed in the
  Vercel project's Domains settings when that setup task is performed, not assumed from general Vercel
  documentation.
- Local-dev tenant subdomains require no separate seeding mechanism: a developer provisions a tenant
  through the existing flow (Spec 2, `/provisioning/new`) against a local database, which immediately
  yields a working `{subdomain}.lvh.me:3000`.
- `/platform/login` (and other root-domain-only paths) requires no special-casing to work identically
  at `lvh.me:3000/platform/login` in local dev — it is gated by root-domain matching (FR-003), which is
  the same logic regardless of environment.
- Custom domains per tenant (Enterprise-tier vanity domains, requirements doc §12.3) are out of scope
  for this feature and are expected to be addressed by a later spec involving DNS verification and
  per-domain SSL provisioning.
- The subdomain-lookup RLS policy (FR-015) requires a new migration adding a `SELECT`-only permissive
  policy to `tenants` (alongside `apps/api/drizzle/0009_rls_tenants.sql`'s existing `tenant_isolation`
  policy) — this is additive (a new policy file), not an edit to the existing migration, consistent
  with how prior RLS migrations in this repo are structured one-per-file.
