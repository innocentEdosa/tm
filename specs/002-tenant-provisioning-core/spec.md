# Feature Specification: Tenant Provisioning Core

**Feature Branch**: `002-tenant-provisioning-core`

**Created**: 2026-07-02

**Status**: Draft

**Input**:  

## Clarifications

### Session 2026-07-02

- Q: Is tenant provisioning self-serve, sales-assisted, or both? → A: Sales-assisted (for now) — an internal sales/customer-success team member runs provisioning on the prospect's behalf; self-serve is out of scope for this milestone.
- Q: Can more than one user account be created during initial provisioning? → A: No — single admin only. Exactly one user account (the HR Admin) is created during provisioning; additional users/roles are added later via a separate team-invite flow.
- Q: How is "primary contact" represented in the data model? → A: Metadata only — stored as plain fields (name/email/phone) directly on the Tenant record itself, not as a separate entity and not tied to the Admin User account.

### Session 2026-07-03

- Q: Spec 4 (Domain-Based Tenant Routing) requires a reserved-subdomain list that no tenant may ever
  claim, so it never resolves as a tenant via routing — should this spec's subdomain validation (FR-002)
  also reject reserved words at submission time, per Spec 4's dependency note? → A: Yes — added as
  FR-016. Provisioning MUST reject a submitted subdomain matching Spec 4's reserved-word list through
  the same rejection path already used for an already-taken subdomain (FR-002), so the two specs never
  rely on two independently-maintained lists.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture Company Details & Create the Tenant Record (Priority: P1)

As an internal sales/customer-success team member onboarding a new company onto TM on the prospect's
behalf, I provide the company's core details (name, subdomain, industry, primary contact) and, on
submission, the platform creates a new tenant record that starts in Trial status — establishing the
tenant as a distinct, isolated entity before any further setup happens.

**Why this priority**: Nothing else in this spec — department setup, admin user creation, role
assignment — can happen without a `tenant_id` to scope those writes to. This is the entry point of
the entire flow and the moment tenant isolation begins.

**Independent Test**: Can be fully tested by submitting company details and confirming a new tenant
record exists with a unique `tenant_id`, the submitted company details persisted, and a status of
"Trial" — independent of whether departments or an admin user have been created yet.

**Acceptance Scenarios**:

1. **Given** no prior tenant exists for a given company, **When** the company details form is
   submitted with a unique subdomain, **Then** a new tenant record is created with a unique
   `tenant_id`, the submitted company details, and a status of "Trial".
2. **Given** a subdomain that is already in use by another tenant, **When** the company details form
   is submitted with that subdomain, **Then** the system rejects the submission and asks for a
   different subdomain, without creating a tenant record.
3. **Given** a newly created tenant record, **When** its status is inspected, **Then** it reads
   "Trial" with no manual step required to set it.

---

### User Story 2 - Create the Initial Admin User & Assign Their Role (Priority: P1)

As the internal sales/customer-success team member onboarding a new company, once the tenant record
exists I provide the initial admin's personal details (name, email, and other identifying info) — the
prospect's own designated administrator, not myself — and the system creates their account, scoped to
the new tenant, and assigns them the HR Admin role (or platform equivalent) from the Spec 1 role
catalog — so the company has one working, permission-bearing login the moment provisioning completes.

**Why this priority**: A provisioned tenant with no usable login is not a usable tenant. This is
sequenced after User Story 1 because it requires a `tenant_id` to scope the new user to, but it is
equally critical to the MVP — provisioning is not "done" from the customer's perspective until
someone can log in.

**Independent Test**: Using a tenant already created via User Story 1, submit the admin's details and
confirm a user account is created scoped to that tenant, holding exactly the HR Admin role from the
Spec 1 catalog, independent of whether departments have been customized yet.

**Acceptance Scenarios**:

1. **Given** a tenant that was just created with Trial status, **When** the admin's details are
   submitted, **Then** a new user account is created, scoped to that tenant's `tenant_id`, with the
   submitted personal details persisted.
2. **Given** the newly created admin account, **When** its role assignment is inspected, **Then** it
   holds the HR Admin role (or platform equivalent) copied from Spec 1's default role templates for
   that tenant, and no other role.
3. **Given** the new admin account and role assignment, **When** the admin logs in for the first time
   (login mechanism itself is out of scope — see Spec 3), **Then** their effective permissions match
   exactly what the HR Admin role template grants, per Spec 1's role model.

---

### User Story 3 - Apply and Customize Department Structure During Setup (Priority: P2)

As the internal sales/customer-success team member onboarding a new company (typically working from
information gathered from the prospect), I see a set of default department templates pre-applied to
the new tenant, and I can rename, add, remove, or restructure those departments during the same
setup flow — so the company's org structure reflects reality from day one without needing engineering
involvement.

**Why this priority**: Sequenced after User Stories 1 and 2 because departments belong to a tenant
that must already exist, and a working admin login (US2) delivers more immediate value than org
structure. It is still P2, not lower, because constitution Principle II requires this configurability
to exist from the start, not bolted on later.

**Independent Test**: Using a tenant already created via User Story 1, confirm the platform's default
department templates are applied automatically, then independently rename one department, add a new
one, and remove another — confirming each change is scoped to that tenant only, persists, and requires
no code change or deployment.

**Acceptance Scenarios**:

1. **Given** a newly created tenant, **When** department setup is reached, **Then** the platform's
   default department templates are pre-applied to that tenant without manual entry.
2. **Given** the pre-applied default departments, **When** the admin renames one, adds a new custom
   department, and removes another, **Then** the changes are saved, scoped to that tenant only, and
   take effect without any code change or deployment.
3. **Given** two tenants provisioned separately, **When** one customizes its department structure,
   **Then** the other tenant's departments (default or previously customized) are entirely unaffected.

---

### Edge Cases

- What happens if a submitted subdomain is already taken? The system MUST reject the submission and
  require a different subdomain before a tenant record is created (US1, Acceptance Scenario 2).
- What happens if a submitted subdomain matches a platform-reserved word (e.g. `www`, `api`, `admin` —
  see Spec 4's reserved-subdomain list)? The system MUST reject the submission and require a different
  subdomain before a tenant record is created, using the same rejection path as an already-taken
  subdomain (FR-016).
- What happens if provisioning fails partway through (e.g. departments are applied but admin user
  creation fails)? The whole provisioning attempt MUST fail as a single unit — no tenant record,
  department, admin user, or role assignment from a failed attempt is left in a partially-created,
  visible, or usable state (see FR-013).
- What happens if the admin's submitted email is already associated with a user account in another
  tenant? The system MUST allow it — a person's email is not globally unique across tenants; the new
  account is a distinct user scoped to the new tenant, isolated from any account of the same email in
  another tenant.
- What happens if the admin tries to remove every department during setup, leaving zero? The system
  MUST allow it, consistent with Spec 1's precedent of not enforcing a mandatory minimum configuration
  on tenant-owned structures — the admin can add departments back at any time after setup.
- What happens if someone attempts to submit company details, department changes, or an admin user
  scoped to a `tenant_id` other than the one just generated for this provisioning attempt? The system
  MUST reject it — every write in this flow is scoped only to the `tenant_id` generated in User Story
  1, never to a client-supplied or different tenant identifier.
- What happens to the HR Admin role assignment if Spec 1's role catalog does not yet contain an "HR
  Admin" (or equivalent) template at the time provisioning runs? Provisioning MUST fail rather than
  create an admin user with no role or a substitute role — this spec has a hard dependency on Spec 1's
  role templates existing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a way to capture company details for a new tenant: company name,
  subdomain (used to derive the tenant's unique platform identifier), industry, and primary contact
  name/email/phone.
- **FR-002**: System MUST validate that the submitted subdomain is not already in use by any existing
  tenant before creating a tenant record, rejecting the submission with a clear message if it is.
- **FR-003**: System MUST generate a new, unique `tenant_id` and create a tenant record the moment
  company details are successfully submitted — this is the first point in the system at which a
  `tenant_id` for this company comes into existence.
- **FR-004**: System MUST set every newly created tenant's status to "Trial" automatically on
  creation, with no manual step required and no other status reachable at creation time. Full
  transition logic between Trial, Active, Suspended, and Cancelled is out of scope for this spec.
- **FR-005**: System MUST scope every subsequent write performed during provisioning — department
  records, the admin user record, and the admin's role assignment — to the `tenant_id` generated in
  FR-003, with server-side enforcement that rejects any write attempting to target a different tenant.
- **FR-006**: System MUST apply the platform's default department templates to a newly created tenant
  automatically as part of provisioning, requiring no manual entry to have a working starting
  structure.
- **FR-007**: System MUST allow the admin, during the same provisioning flow, to rename, add, remove,
  or restructure departments applied in FR-006, entirely within their own tenant and without requiring
  a code change or deployment.
- **FR-008**: System MUST provide a way to capture the initial admin user's personal details (at
  minimum: full name, email) as part of provisioning.
- **FR-009**: System MUST create a user account for the initial admin, scoped to the tenant created in
  FR-003, using the details captured in FR-008.
- **FR-010**: System MUST assign the initial admin user the HR Admin role (or the platform's
  equivalent top-level tenant-admin role) from Spec 1's default role templates, copied into that
  tenant's own roles per Spec 1's FR-005, as part of provisioning — with no protected action available
  to the admin beyond what that role template grants.
- **FR-011**: System MUST restrict initial provisioning to creating exactly one admin user; adding
  further users, whether admins or other roles, MUST happen through a separate, later flow (e.g. team
  invites), not as part of this spec.
- **FR-012**: System MUST NOT include any plan-tier selection, feature-flag configuration, or usage
  limit assignment as part of this provisioning flow — the tenant record produced by this spec carries
  Trial status only, and is structured so plan-tier data (Spec 5), authentication method (Spec 3), and
  branding/theming (Spec 4) can each be attached afterward without requiring changes to this spec's
  data model.
- **FR-013**: System MUST treat a single provisioning attempt (company details → tenant record →
  department setup → admin user creation → role assignment) as an atomic, all-or-nothing operation:
  if any step fails, the system MUST leave no partially-created tenant, department, admin user, or
  role assignment visible or usable from that attempt, and MUST report the failure so the person
  provisioning can retry.
- **FR-014**: System MUST fail provisioning outright if the required admin role template (HR Admin or
  platform equivalent) is not present in Spec 1's role catalog at the time of the attempt, rather than
  creating an admin user with no role or a substitute role.
- **FR-015**: System MUST support provisioning being performed by an internal sales/customer-success
  team member acting on the prospect's behalf (sales-assisted); self-serve provisioning, where the
  prospect's own staff runs the flow directly with no internal team member involved, is out of scope
  for this milestone (see Clarifications).
- **FR-016**: System MUST validate a submitted subdomain against the platform's reserved-subdomain list
  (defined in Spec 4, Domain-Based Tenant Routing) before creating a tenant record, rejecting the
  submission with a clear message — via the same rejection path as FR-002 — if it matches a reserved
  word, so a tenant can never claim a subdomain that must never resolve as a tenant via routing.

### Key Entities

- **Tenant**: The platform-level record representing a single onboarded company. Attributes: unique
  `tenant_id`, company name, subdomain, industry, primary contact info, status (Trial at creation;
  Active/Suspended/Cancelled reachable only through future, out-of-scope transition logic). Created
  once, in User Story 1, and referenced by every other entity below via `tenant_id`. Structured to be
  extended later by Spec 5 (plan-tier data), Spec 4 (branding), and Spec 3 (auth method) without schema
  rework.
- **Department**: A tenant-owned unit of org structure. Attributes: name, parent/child relationship (if
  restructuring supports hierarchy), owning `tenant_id`. Seeded from platform default department
  templates at provisioning time (FR-006), then freely renamable/addable/removable within its own
  tenant (FR-007).
- **Department Template**: A platform-level default department definition (e.g. "HR", "Sales",
  "Engineering") used to seed a new tenant's departments. Not itself tenant-scoped; analogous in role to
  Spec 1's Role Template.
- **Admin User**: The initial user account created for a tenant during provisioning. Attributes: full
  name, email, other captured personal details, owning `tenant_id`. Exactly one is created per
  provisioning attempt (FR-011).
- **User-Role Assignment**: Reuses Spec 1's User-Role Assignment entity — links the new Admin User to
  the tenant's copy of the HR Admin role, established at provisioning time (FR-010).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new tenant — company details, default departments, one admin user, and that admin's
  role assignment — can be fully provisioned in a single sitting in under 10 minutes.
- **SC-002**: 100% of newly created tenants have a status of "Trial" immediately after provisioning,
  with zero manual status-setting steps performed by the person provisioning.
- **SC-003**: 100% of departments, the admin user record, and the role assignment created during
  provisioning are correctly scoped to the new tenant's `tenant_id`, verified by confirming zero
  cross-tenant visibility across at least two independently provisioned test tenants.
- **SC-004**: An admin can rename, add, or remove a department during setup and see the change persist
  without engineering support or a deployment, in under 2 minutes for a single change.
- **SC-005**: 0% of simulated mid-provisioning failures (e.g. admin user creation failing after
  departments were applied) leave a partially-created tenant visible or usable in the system.
- **SC-006**: 100% of newly provisioned admin users can have their effective permissions verified as
  matching exactly the HR Admin role template's permission set, with no extra or missing permissions.

## Constitution Alignment *(mandatory)*

- **Tenant-isolation model impact**: Shared schema w/ RLS, consistent with Spec 1. The `Tenant` record
  itself is the platform-level row that all other tenant-scoped tables reference by `tenant_id`.
  Department, Admin User, and User-Role Assignment records are tenant-scoped tables isolated via
  row-level security keyed on the `tenant_id` first generated in User Story 1 (FR-003). Department
  Templates are platform-wide, shared, read-only reference data (no `tenant_id`), analogous to Spec 1's
  Role Templates.
- **Tenant-configurable vs. fixed platform-wide**: Configurable per tenant — department names,
  structure, and count after the default templates are applied (FR-007), and company detail values
  (name, subdomain, contact info) captured at provisioning. Fixed platform-wide, intentionally not
  tenant-configurable — the set of default department templates offered at provisioning time (FR-006;
  changing the templates themselves is a platform-level change), the identity of the role
  (HR Admin) assigned to the initial admin (FR-010), which is fixed by this spec to guarantee every
  tenant starts with exactly one working administrator, and the reserved-subdomain list a tenant can
  never claim (FR-016; owned by Spec 4, enforced here at submission time).
- **AI-generation review/approval step**: N/A — this feature does not generate AI content.
- **Kirkpatrick L4/L5 data source & formula**: N/A — this feature does not touch Results/ROI evaluation.
- **Downgrade/cancellation behavior**: N/A for this spec directly — it only establishes the Trial
  starting state (FR-004) and explicitly does not implement Active/Suspended/Cancelled transition
  logic. The tenant record's status field is structured so a future spec can implement those
  transitions without schema rework; that spec is responsible for downgrade/cancellation behavior.
- **Design system reference**: This feature includes new UI screens (company details form, department
  setup/customization screen, admin user creation form). No design system has been locked yet per
  Principle V at the time of this spec. Implementation of these screens MUST either reference the
  design system once it is established, or explicitly flag this as one of the first features to
  establish it, per Principle V's process.
- **Demoable vs. internal**: Stakeholder-demoable. The entire flow — entering company details, seeing
  default departments appear and customizing them, creating the admin account, and landing on a
  freshly provisioned Trial-status tenant with a working admin login — is a coherent, end-to-end demo a
  non-technical stakeholder can watch and follow without needing Specs 3, 4, or 5 to exist yet.

## Assumptions

- Primary contact info (captured in company details, FR-001) is stored as plain fields on the Tenant
  record itself, confirmed via stakeholder clarification — not as a separate entity and not tied to
  the initial admin's account details (FR-008). Under the sales-assisted model (see Clarifications),
  the internal team member performing provisioning is neither the primary contact nor the admin — the
  primary contact may be the prospect's business decision-maker while the admin is a different person
  (e.g. an IT/HR operations contact) the prospect designates to receive the account.
- Initial provisioning is single-admin-only (FR-011): exactly one admin user is created during this
  flow, and inviting additional team members/roles is treated as a separate, later feature. Confirmed
  via stakeholder clarification (see Clarifications) — this mirrors common SaaS onboarding patterns
  (one owner account first, team invites after).
- Provisioning is treated as atomic/all-or-nothing (FR-013): if any step fails, nothing from that
  attempt is left visible or usable. This is the safer default to avoid partially-provisioned tenants
  reaching production data. **Flagged for stakeholder sign-off**, since the exact mechanism (single
  transaction vs. a multi-step rollback/compensation process) is a planning-level decision this spec
  does not prescribe.
- Subdomains are assumed to be globally unique across the entire platform (FR-002), since they are used
  to route requests to the correct tenant.
- The reserved-subdomain list enforced by FR-016 is owned and defined by Spec 4 (Domain-Based Tenant
  Routing), not duplicated here — this spec's provisioning validation consults that single shared list
  rather than maintaining its own, so the two never drift apart (added 2026-07-03, see Clarifications).
- Department restructuring during setup is assumed to support at least flat (non-hierarchical)
  add/rename/remove; whether nested/hierarchical department trees are required is left to whichever
  future feature builds the ongoing (post-setup) department management screens, since this spec is
  scoped to initial setup only.
- This spec assumes Spec 1 (Roles & Permissions Model) has already shipped its default role templates,
  including an HR Admin (or equivalent) template, before this feature can be implemented — this is a
  hard sequencing dependency, not a soft one (see FR-014, Edge Cases).
