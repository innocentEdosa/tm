import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tenants } from "../db/schema/tenants";
import { isReservedSubdomain } from "../tenant-routing/reserved-subdomains";
import { SubdomainTakenError, ReservedSubdomainError } from "../provisioning/provision-tenant";
import { TenantNotFoundError, TenantLockedError } from "./errors";
import { logTenantAction } from "./log-tenant-action";

export interface EditTenantInput {
  name?: string;
  industry?: string;
  subdomain?: string;
  primaryContact?: { name?: string; email?: string; phone?: string };
}

interface PgErrorCause {
  code?: string;
}

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: PgErrorCause })?.cause?.code;
}

/**
 * contracts/tenant-management-api.md `PATCH /tenants/:id` (spec FR-005, FR-006, FR-012; research.md
 * §2). `db` must be `request.superAdminDb`. A `subdomain` change reuses Tenant Provisioning Core's
 * own uniqueness (unique-violation → `SubdomainTakenError`) and reserved-word
 * (`isReservedSubdomain` → `ReservedSubdomainError`) checks verbatim — never a second,
 * independently-maintained validation path.
 */
export async function editTenant(
  db: Db,
  params: { tenantId: string; superAdminId: string; input: EditTenantInput },
): Promise<{ id: string; name: string; subdomain: string; status: string }> {
  const [current] = await db
    .select({
      id: tenants.id,
      subdomain: tenants.subdomain,
      archivedAt: tenants.archivedAt,
      deletionRequestedAt: tenants.deletionRequestedAt,
    })
    .from(tenants)
    .where(eq(tenants.id, params.tenantId));

  if (!current) {
    throw new TenantNotFoundError(`No tenant with id ${params.tenantId}`);
  }
  if (current.archivedAt || current.deletionRequestedAt) {
    throw new TenantLockedError("Reactivate this tenant before editing it");
  }

  const { input } = params;
  const values: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name;
  if (input.industry !== undefined) values.industry = input.industry;
  if (input.primaryContact?.name !== undefined) values.primaryContactName = input.primaryContact.name;
  if (input.primaryContact?.email !== undefined) values.primaryContactEmail = input.primaryContact.email;
  if (input.primaryContact?.phone !== undefined) values.primaryContactPhone = input.primaryContact.phone;

  // FR-006 edge case: a same-value subdomain "change" is a no-op save, not a validation failure.
  if (input.subdomain !== undefined && input.subdomain !== current.subdomain) {
    if (isReservedSubdomain(input.subdomain)) {
      throw new ReservedSubdomainError(`Subdomain "${input.subdomain}" is reserved and cannot be used`);
    }
    values.subdomain = input.subdomain;
  }

  let updated: { id: string; name: string; subdomain: string; status: string };
  try {
    [updated] = await db
      .update(tenants)
      .set(values)
      .where(eq(tenants.id, params.tenantId))
      .returning({ id: tenants.id, name: tenants.name, subdomain: tenants.subdomain, status: tenants.status });
  } catch (err) {
    if (pgErrorCode(err) === "23505") {
      throw new SubdomainTakenError(`Subdomain "${input.subdomain}" is already in use`);
    }
    throw err;
  }

  await logTenantAction(db, { tenantId: params.tenantId, superAdminId: params.superAdminId, action: "edit" });

  return updated;
}
