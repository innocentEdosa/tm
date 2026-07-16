/** Shared across every Super Admin Tenant Console route (contracts/super-admin-tenant-console-api.md). */
export class TenantNotFoundError extends Error {}

/** `:memberId` did not resolve scoped to `:id`'s tenant — wrong tenant, or nonexistent (spec FR-008,
 * Edge Cases). Never distinguished from a plain "wrong id" in the response, to avoid leaking whether
 * a given id belongs to some other tenant. */
export class MemberNotFoundError extends Error {}
