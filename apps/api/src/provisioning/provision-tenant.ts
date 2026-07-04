import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tenants } from "../db/schema/tenants";
import { departments } from "../db/schema/departments";
import { users } from "../db/schema/users";
import { roles, userRoles } from "../db/schema/roles";
import { roleTemplates } from "../db/schema/role-templates";
import { seedDefaultRolesForTenant } from "../permissions/seed-default-roles";
import { seedDefaultDepartmentsForTenant } from "./seed-default-departments";
import { isReservedSubdomain } from "../tenant-routing/reserved-subdomains";
import { tenantAuthMethods } from "../db/schema/tenant-auth-methods";
import { generateOneTimePassword, otpExpiryFromNow } from "../tenant-auth/otp";
import { hashPassword } from "../platform-auth/password";
import { sendOneTimePasswordEmail } from "../tenant-auth/mailer";

export class SubdomainTakenError extends Error {}
export class ReservedSubdomainError extends Error {}
export class MissingAdminRoleTemplateError extends Error {}
export class DuplicateDepartmentNameError extends Error {}

export interface ProvisionTenantInput {
  company: {
    name: string;
    subdomain: string;
    industry?: string;
    primaryContact: { name: string; email: string; phone?: string };
  };
  departments?: { name: string }[];
  admin: { fullName: string; email: string };
}

export interface ProvisionTenantResult {
  tenant: { id: string; name: string; subdomain: string; status: string };
  departments: { id: string; name: string }[];
  admin: { id: string; fullName: string; email: string; roleAssigned: string };
}

interface PgErrorCause {
  code?: string;
}

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: PgErrorCause })?.cause?.code;
}

/**
 * The single atomic provisioning transaction (research.md §1, §3; spec FR-013). Generates the new
 * tenant's id in application code and sets `app.tenant_id` to it *before* any insert, so every
 * write in this function — including the `tenants` row itself — is scoped by RLS from its first
 * write onward (research.md §1). Any thrown error rolls back the whole attempt: no `tenants`,
 * `departments`, `users`, or `user_roles` row from a failed attempt is left behind (FR-013).
 */
export async function provisionTenant(
  pool: Pool,
  input: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
  const tenantId = randomUUID();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const tenantDb: Db = drizzle(client);

    // FR-014: fail closed before any write if the required admin role template is missing.
    const [hrAdminTemplate] = await tenantDb
      .select({ id: roleTemplates.id })
      .from(roleTemplates)
      .where(eq(roleTemplates.key, "hr_admin"));
    if (!hrAdminTemplate) {
      throw new MissingAdminRoleTemplateError(
        "hr_admin role template not found in role_templates catalog",
      );
    }

    // Spec 4 FR-016: reject a reserved subdomain before attempting the insert — checked against the
    // same canonical list tenant routing consults (apps/api/src/tenant-routing/reserved-subdomains.ts),
    // so this and the routing layer never rely on two independently-maintained lists.
    if (isReservedSubdomain(input.company.subdomain)) {
      throw new ReservedSubdomainError(
        `Subdomain "${input.company.subdomain}" is reserved and cannot be used`,
      );
    }

    // US1 (FR-001-FR-004): create the tenant record. Trial status comes from the column default.
    let createdTenant: { id: string; name: string; subdomain: string; status: string };
    try {
      [createdTenant] = await tenantDb
        .insert(tenants)
        .values({
          id: tenantId,
          name: input.company.name,
          subdomain: input.company.subdomain,
          industry: input.company.industry,
          primaryContactName: input.company.primaryContact.name,
          primaryContactEmail: input.company.primaryContact.email,
          primaryContactPhone: input.company.primaryContact.phone,
        })
        .returning({
          id: tenants.id,
          name: tenants.name,
          subdomain: tenants.subdomain,
          status: tenants.status,
        });
    } catch (err) {
      if (pgErrorCode(err) === "23505") {
        throw new SubdomainTakenError(`Subdomain "${input.company.subdomain}" is already in use`);
      }
      throw err;
    }

    // Tenant Authentication Configuration spec FR-003: a sensible default login method, enabled
    // automatically with no manual setup — email/password requires no external provider.
    await tenantDb.insert(tenantAuthMethods).values({ tenantId, method: "email_password" });

    // US2 (FR-008-FR-011): create the admin user and assign the HR Admin role.
    // Tenant Authentication Configuration spec FR-013: the account has no usable password until it
    // sets one — a one-time password (hashed like any real password, research.md §6) is generated
    // now and emailed once the transaction commits (below), never before — email delivery must
    // never gate whether the tenant itself gets created.
    const oneTimePassword = generateOneTimePassword();
    const [createdAdmin] = await tenantDb
      .insert(users)
      .values({
        tenantId,
        fullName: input.admin.fullName,
        email: input.admin.email,
        passwordHash: await hashPassword(oneTimePassword),
        mustChangePassword: true,
        otpExpiresAt: otpExpiryFromNow(),
      })
      .returning({ id: users.id, fullName: users.fullName, email: users.email });

    await seedDefaultRolesForTenant(tenantDb, tenantId);

    const [hrAdminRole] = await tenantDb
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.sourceTemplateId, hrAdminTemplate.id)));

    await tenantDb.insert(userRoles).values({ tenantId, userId: createdAdmin.id, roleId: hrAdminRole.id });

    // US3 (FR-006-FR-007): seed default departments, or the submitted customized list.
    let createdDepartments: { id: string; name: string }[];
    try {
      if (input.departments === undefined) {
        await seedDefaultDepartmentsForTenant(tenantDb, tenantId);
      } else if (input.departments.length > 0) {
        await tenantDb
          .insert(departments)
          .values(input.departments.map((d) => ({ tenantId, name: d.name })));
      }
      createdDepartments = await tenantDb
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(eq(departments.tenantId, tenantId));
    } catch (err) {
      if (pgErrorCode(err) === "23505") {
        throw new DuplicateDepartmentNameError("Duplicate department name in submitted list");
      }
      throw err;
    }

    await client.query("COMMIT");

    // Sent only after COMMIT succeeds, and never allowed to throw (it catches and logs internally,
    // research.md/spec Edge Cases) — a slow/unreachable SMTP server can never fail or roll back an
    // otherwise-successful provisioning attempt.
    await sendProvisioningOneTimePasswordEmail({ email: createdAdmin.email, otp: oneTimePassword });

    return {
      tenant: createdTenant,
      departments: createdDepartments,
      admin: {
        id: createdAdmin.id,
        fullName: createdAdmin.fullName,
        email: createdAdmin.email,
        roleAssigned: hrAdminRole.name,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Never throws — catches and logs internally (see call site's comment above). */
async function sendProvisioningOneTimePasswordEmail(target: { email: string; otp: string }): Promise<void> {
  try {
    await sendOneTimePasswordEmail(target.email, target.otp);
  } catch (err) {
    console.error(`Failed to send provisioning one-time-password email to ${target.email}:`, err);
  }
}
