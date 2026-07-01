# Feature Specification: Roles & Permissions Model

**Feature Branch**: `001-roles-permissions-model`

**Created**: 2026-07-01

**Status**: Draft

**Input**: User description: "Build the foundational permission and role system for TM, used platform-wide across all tenants. This is a prerequisite for tenant provisioning, admin user creation, department management, and approval workflows — it has no dependency on any specific tenant existing yet. Define permissions as first-class data, roles as named bundles of permissions, default role templates (Super Admin, HR/L&D Admin, Manager, Employee/Learner), tenant-configurable roles per constitution Principles II & III, tenant-isolation impact, server-side enforcement, and demoable/internal status."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Platform-Wide Permission Catalog & Default Role Templates (Priority: P1)

As a platform operator, every checkable capability in TM (e.g. `approve_enrollment`,
`edit_content_library`, `view_department_analytics`) is defined once in a single, shared catalog, and
grouped into default role templates — Super Admin, HR/L&D Admin, Manager, and Employee/Learner — so
that every tenant starts from a consistent, sensible set of access rules the moment it is provisioned.

**Why this priority**: Nothing else in the platform — tenant provisioning, admin user creation,
department management, approval workflows — can be built until this primitive exists. It is the
foundation every other role/permission-dependent feature will build on.

**Independent Test**: Can be fully tested by querying the permission catalog and the four default role
templates directly (e.g., via a Super Admin view) and confirming each template maps to the expected set
of permissions — with zero tenants provisioned yet.

**Acceptance Scenarios**:

1. **Given** the platform has just been set up with no tenants, **When** the permission catalog is
   queried, **Then** it returns a complete list of discrete, named permissions (not a hardcoded enum in
   application code) covering enrollment, content, and analytics capabilities at minimum.
2. **Given** the default role templates, **When** each is inspected, **Then** Super Admin, HR/L&D
   Admin, Manager, and Employee/Learner each show a distinct, sensible starting set of permissions.

---

### User Story 2 - Server-Side Enforcement of Every Protected Action (Priority: P2)

As any authenticated user, when I attempt an action the system considers protected, the system checks
— on the server, every time — whether my assigned role(s) within my own tenant actually grant that
permission, regardless of what my client sends.

**Why this priority**: This is the security backbone of the entire model (constitution Principle I);
without it, the permission catalog and role templates from User Story 1 are just inert data with no
protective effect. It depends on User Story 1's catalog existing, which is why it is sequenced second.

**Independent Test**: Can be fully tested by attempting a protected action as a user whose assigned
role does not include the required permission, and separately by attempting the same action while the
request claims a different tenant than the user's actual tenant — and confirming the system denies both
attempts every time, independent of any UI.

**Acceptance Scenarios**:

1. **Given** a user whose roles do not include a given permission, **When** they attempt the protected
   action tied to that permission, **Then** the system denies the action.
2. **Given** a request that supplies a tenant identifier different from the authenticated user's actual
   tenant, **When** the system evaluates the request, **Then** it denies the action based on the
   server-verified tenant, never the client-supplied one.
3. **Given** a user with no roles assigned at all, **When** they attempt any protected action, **Then**
   the system denies it by default.

---

### User Story 3 - Per-Tenant Role Customization Without Code Changes (Priority: P3)

As an HR/L&D admin within a tenant, I can rename a default role, add or remove permissions from it, or
create an entirely new role built from the platform's permission catalog — without needing engineering
involvement.

**Why this priority**: This is the configurability guarantee the constitution requires (Principles II
and III). It is sequenced last only because it builds on the catalog (US1) and enforcement (US2)
already existing — the platform is not usable by real, distinct customer organizations without it.

**Independent Test**: Using a seeded test tenant, rename a role, remove one of its permissions, add a
brand-new role built from existing catalog permissions, and confirm the changes are isolated to that
tenant, take effect without a deployment, and do not alter any other tenant's roles.

**Acceptance Scenarios**:

1. **Given** a tenant's default "Manager" role, **When** an HR/L&D admin renames it and removes one
   permission, **Then** the change is scoped to that tenant only and requires no code change or
   deployment.
2. **Given** a tenant admin creates a brand-new role from existing catalog permissions, **When** it is
   assigned to a user, **Then** that user's effective permissions reflect exactly the new role's
   permission set.
3. **Given** two different tenants, **When** one tenant renames or reconfigures a role, **Then** the
   other tenant's roles are entirely unaffected.

---

### Edge Cases

- What happens when a user is assigned zero roles? The system MUST deny every protected action by
  default (see US2, Acceptance Scenario 3).
- What happens when a tenant admin tries to delete a role that still has users assigned to it? The
  system MUST block the deletion (or require an explicit reassignment step first) rather than silently
  orphaning those users.
- What happens when a user holds multiple roles whose permission sets differ? Effective permissions are
  the union of all permissions across the user's assigned roles — there is no "conflict," only
  additive grants.
- What happens when a tenant renames a role (e.g. "Manager" → "Team Lead")? Nothing breaks, because
  permission checks are always evaluated against permission keys, never against role names.
- What happens when the platform later ships a new permission tied to a new protected action? It MUST
  NOT be automatically added to any existing role (default or tenant-customized) — an admin must
  explicitly add it, preventing silent privilege escalation.
- What happens when a tenant tries to remove all permissions from every role it has? That is allowed —
  the tenant simply locks all its users out of every protected action until an admin restores access;
  the system does not enforce a mandatory minimum permission set on tenant-owned roles.
- What happens to the platform-level Super Admin role if someone attempts to customize it from within a
  tenant context? The system MUST reject the attempt — Super Admin is not tenant-owned and is not
  reachable through any tenant-scoped role-management surface.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST maintain a single, platform-wide catalog of permissions, each identified by a
  stable key (e.g., `approve_enrollment`), as first-class data rather than a hardcoded enum in
  application code.
- **FR-002**: System MUST restrict changes to the permission catalog itself (adding, removing, or
  redefining a permission) to platform-level changes shipped with the corresponding enforcement code —
  no tenant or tenant admin can create, rename, or delete a catalog permission.
- **FR-003**: System MUST support "roles" as named bundles of zero or more permissions drawn from the
  platform catalog.
- **FR-004**: System MUST ship default role templates — Super Admin, HR/L&D Admin, Manager, and
  Employee/Learner — each pre-populated with a sensible starting permission set.
- **FR-005**: System MUST make default role templates copyable into a tenant's own editable roles
  (the act of provisioning a tenant and performing that copy is out of scope for this spec; this spec
  guarantees only that the templates exist and are structured to be copied).
- **FR-006**: System MUST allow tenant admins to rename a role, add or remove permissions on a role
  (chosen only from the platform catalog), and create entirely new roles — all scoped to their own
  tenant — without requiring a code change or deployment.
- **FR-007**: System MUST treat the Super Admin role as platform-level: it is not owned by, customizable
  by, renamable by, or deletable from within any tenant.
- **FR-008**: System MUST support assigning one or more roles to a single user; a user's effective
  permissions MUST be the union of all permissions granted by their currently assigned roles, evaluated
  within their own tenant.
- **FR-009**: For every protected action, the system MUST verify server-side — using the authenticated
  session's actual tenant and role assignments, never client-supplied tenant or role claims — that the
  acting user holds at least one role granting the required permission before allowing the action.
- **FR-010**: System MUST deny by default: a user with no roles, or whose assigned roles collectively
  lack a given permission, MUST NOT be able to perform the protected action tied to that permission.
- **FR-011**: System MUST NOT automatically add a newly introduced permission to any existing role
  (default template or tenant-customized); a permission becomes part of a role only when an admin
  explicitly adds it.
- **FR-012**: System MUST prevent deletion of a role that still has users assigned to it, requiring
  reassignment first.
- **FR-013**: System MUST provide a way (available to Super Admins) to view the permission catalog and
  how each default role template maps permissions to roles.

### Key Entities

- **Permission**: A discrete, checkable capability (e.g. `approve_enrollment`, `edit_content_library`,
  `view_department_analytics`). Platform-wide, not tenant-scoped. Attributes: stable key, display name,
  description, category (e.g. Enrollment, Content, Analytics).
- **Role Template**: A platform-level, named default bundle of permissions (Super Admin, HR/L&D Admin,
  Manager, Employee/Learner) used as the starting point when a tenant is provisioned. Not itself
  assignable to a user directly — tenants get their own copy as a Role.
- **Role**: A named, tenant-owned bundle of permissions. Originates from a Role Template or is created
  directly by a tenant admin. Renamable and re-configurable (which permissions it includes) entirely
  within its owning tenant. The Super Admin role is the one exception: it exists at the platform level,
  outside tenant ownership.
- **User-Role Assignment**: Links a user to one or more Roles within their own tenant; determines that
  user's effective (unioned) permissions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All four default role templates (Super Admin, HR/L&D Admin, Manager, Employee/Learner)
  are viewable with their full permission mappings immediately after this feature ships, with zero
  manual data entry required.
- **SC-002**: A tenant admin can rename a role, change its permissions, or add a new role, and see the
  change take effect for affected users — without engineering support or a deployment — in under 5
  minutes for a single change.
- **SC-003**: 100% of attempts to perform a protected action without the required permission are
  denied, verified across representative test scenarios including a spoofed tenant identifier and a
  spoofed role claim.
- **SC-004**: 0 instances of one tenant's role rename or permission change affecting another tenant's
  roles or users, verified by testing role changes across at least two isolated test tenants.
- **SC-005**: A newly introduced platform permission never appears automatically on any pre-existing
  role — confirmed by inspecting all existing roles immediately after a new permission is added to the
  catalog.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema w/ RLS. The permission catalog and role templates
  are platform-wide, shared tables with no `tenant_id` (they are read-only reference data from every
  tenant's perspective). Roles, role-permission mappings, and user-role assignments are tenant-scoped
  tables, isolated by `tenant_id` and enforced via row-level security — except the Super Admin role and
  its assignments, which live outside tenant scope entirely at the platform level. This split lets the
  one thing that must never vary (what a permission means, tied to actual enforcement code) stay
  single-source-of-truth, while the thing tenants must be able to customize (which permissions a role
  includes) is fully tenant-isolated.
- **Tenant-configurable vs. fixed platform-wide**: Configurable per tenant — role names, role
  descriptions, which catalog permissions a role includes, and creation of entirely new roles (FR-006).
  Fixed platform-wide, intentionally not tenant-configurable — the existence and definition of
  permissions themselves (FR-002), and the Super Admin role (FR-007), because a permission only has
  meaning tied to real server-side enforcement code, and Super Admin is a platform-operator concept that
  exists outside any tenant's ownership.
- **AI-generation review/approval step**: N/A — this feature does not generate AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI evaluation.
- **Downgrade/cancellation behavior**: This is a security-foundational module. On tenant downgrade or
  cancellation, that tenant's role, role-permission, and user-role-assignment data MUST be retained (not
  deleted), so re-activation restores the same access model without reconfiguration. Enforcement (US2)
  MUST continue to deny all protected actions for users of a cancelled tenant regardless of their
  previously assigned roles.
- **Design system reference**: N/A for this spec's primary scope — the permission catalog, role data
  model, and server-side enforcement are backend primitives with no end-user screen. The minimal Super
  Admin read-only catalog/template view from User Story 1 (FR-013) is a UI surface and MUST reference
  the established design system once locked (Principle V), or explicitly flag a design-system change,
  when it is implemented.
- **Demoable vs. internal**: Primarily internal/infrastructure — the permission catalog, role data
  model, and server-side enforcement layer are backend primitives with no direct end-user screen. The
  minimal Super Admin read-only view of the permission catalog and default role templates (User Story 1,
  FR-013) is the stakeholder-demoable slice for this milestone.

## Assumptions

- A single shared Postgres database with row-level, `tenant_id`-scoped isolation (shared schema + RLS)
  is assumed as the current isolation model, consistent with the single Postgres service already in
  this repo's docker-compose setup; no schema-per-tenant or dedicated-DB infrastructure exists yet.
- To test and demo per-tenant role customization (User Story 3) before the tenant-provisioning feature
  ships, a seed/test tenant is assumed to exist for QA purposes; the real onboarding flow that creates
  tenants is a separate, out-of-scope feature.
- A user can hold multiple roles at once, with effective permissions being the union across those
  roles — chosen as the more complete option per constitution Principle VIII (comprehensive-version
  rule), since a single-role-per-user model was also a reasonable simpler alternative. **Flagged for
  stakeholder sign-off** before implementation, given the added complexity of union-based permission
  resolution.
- The Super Admin role is a single, flat platform role for this milestone — no scoped or limited
  platform-operator sub-roles (e.g. read-only support staff) yet. **Flagged for stakeholder sign-off**
  as a plausible near-term extension once the Super Admin console takes shape.
- New permissions are never auto-added to existing roles (FR-011); an admin must explicitly opt a role
  into a new permission. **Flagged for stakeholder sign-off**, since some teams prefer certain "safe"
  permissions to auto-propagate — this spec defaults to the stricter, explicit-only behavior to avoid
  silent privilege escalation.
- Deleting a role with assigned users is blocked rather than cascading (FR-012); the exact reassignment
  UX (e.g. forced picker vs. fallback role) is left to whichever future feature builds role-management
  screens.
- Tenant provisioning, department creation, and admin user creation are explicitly out of scope for
  this spec — it produces only the permission/role primitive those features will depend on.
