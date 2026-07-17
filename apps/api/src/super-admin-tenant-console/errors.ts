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
