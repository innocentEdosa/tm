/** Shared across every Super Admin Tenant Console route (contracts/super-admin-tenant-console-api.md). */
export class TenantNotFoundError extends Error {}

/** `:memberId` did not resolve scoped to `:id`'s tenant — wrong tenant, or nonexistent (spec FR-008,
 * Edge Cases). Never distinguished from a plain "wrong id" in the response, to avoid leaking whether
 * a given id belongs to some other tenant. */
export class MemberNotFoundError extends Error {}

/** Super Admin Add Member spec (021) — `roleId` did not resolve scoped to the target tenant, wrong
 * tenant or nonexistent alike (spec FR-003, contracts/super-admin-add-member-api.md). */
export class RoleNotFoundError extends Error {}

/** Super Admin Add Member spec (021) — `departmentId` did not resolve to an active department
 * scoped to the target tenant (spec FR-003). */
export class DepartmentNotActiveError extends Error {}

/** Super Admin Add Member spec (021) — the submitted email is already in use by another member of
 * the same tenant (spec FR-004). */
export class EmailConflictError extends Error {}

/** Super Admin Edit Tenant Configuration spec (022) — a role/department/custom-field id did not
 * resolve scoped to `:id`'s tenant — wrong tenant, or nonexistent. Mirrors `MemberNotFoundError`'s
 * own reasoning: never distinguished from a plain "wrong id," to avoid leaking whether a given id
 * belongs to some other tenant (or, for custom fields, is a global row — spec FR-009, research.md
 * §2, since RLS alone would otherwise let that row resolve). */
export class RecordNotFoundError extends Error {}

/** Super Admin Edit Tenant Configuration spec (022) — the target role has a non-null
 * `sourceTemplateId` (a system role derived from a platform role template) and can never be edited
 * or deleted, by anyone, Super Admin included (spec FR-005), mirroring
 * `tenant-role-routes.ts`'s own `SYSTEM_ROLE_MESSAGE` guard. */
export class SystemRoleError extends Error {}

/** Super Admin Edit Tenant Configuration spec (022) — the target role has at least one member still
 * assigned and cannot be deleted until they're reassigned (spec FR-005), mirroring
 * `tenant-role-routes.ts`'s own `23503` FK-violation handling on `DELETE /tenant/roles/:roleId`. */
export class RoleInUseError extends Error {}

/** Super Admin Edit Tenant Configuration spec (022) — the submitted role name already exists for
 * this tenant (spec FR-004), mirroring `POST /tenant/roles`'s own `23505`-conflict handling. */
export class RoleNameConflictError extends Error {}

/** Super Admin Edit Tenant Configuration spec (022) — a department hierarchy or Manager/Assistant
 * Manager validation failure (spec FR-007): parent not found, a cycle, exceeding the 3-level nesting
 * cap, Manager/Assistant Manager the same person, or a Manager/Assistant Manager id that doesn't
 * resolve — mirrors `tenant-department-routes.ts`'s own `validateHierarchyAndManagers` messages
 * exactly, carried on `.message` since the underlying check has several distinct wordings. */
export class DepartmentValidationError extends Error {}

/** Super Admin Edit Tenant Configuration spec (022) — the submitted department name already exists
 * (case-insensitively) for this tenant (spec FR-007), mirroring
 * `POST`/`PATCH /tenant/departments`'s own `23505`-conflict handling. */
export class DepartmentNameConflictError extends Error {}

/** Super Admin Edit Tenant Configuration spec (022) — the submitted field key collides with an
 * existing global or this tenant's own field for the same form type (spec FR-008), mirroring
 * `POST /tenant/form-fields`'s own `fieldKeyCollisionExists` check. */
export class FieldKeyConflictError extends Error {}
