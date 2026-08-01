import { eq } from "drizzle-orm";
import { tenants } from "../db/schema/tenants";
import type { Db } from "../db/client";

/**
 * Every storage key's top-level folder is the tenant's `subdomain`, not its raw `id` — readable
 * when browsing the bucket directly, and (unlike `tenants.name`) guaranteed unique per tenant (DB
 * unique constraint), so two tenants can never share a folder even if they share a display name.
 * RLS-scoped read (`tenant_isolation` policy, `0009_rls_tenants.sql`) through the caller's own
 * `request.tenantDb` — a tenant can only ever resolve its own row.
 */
export async function resolveTenantStorageFolder(tenantDb: Db, tenantId: string): Promise<string> {
  const [tenant] = await tenantDb.select({ subdomain: tenants.subdomain }).from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) {
    throw new Error("Tenant not found while resolving storage folder");
  }
  return tenant.subdomain;
}
