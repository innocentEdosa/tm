/** Shared across every tenant-management action (contracts/tenant-management-api.md). */
export class TenantNotFoundError extends Error {}

/** FR-012 — target tenant is archived or pending deletion; reactivate/recover it first. */
export class TenantLockedError extends Error {}

/** FR-013, FR-014 — `confirmTenantName` was missing or did not exactly match the tenant's name. */
export class TenantDeleteConfirmationMismatchError extends Error {}

/** FR-015a edge case — recover attempted on a tenant that isn't currently pending deletion. */
export class TenantNotPendingDeletionError extends Error {}
