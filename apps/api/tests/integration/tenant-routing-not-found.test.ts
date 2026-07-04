import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll } from "vitest";
import { closeTestPool, getTestPool } from "../helpers/pg";
import { resolveTenantBySubdomain } from "../../src/tenant-routing/resolve-tenant";

describe("resolveTenantBySubdomain — unclaimed subdomain (US3)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("returns not_found for a subdomain matching no tenant record and not reserved", async () => {
    const result = await resolveTenantBySubdomain(getTestPool(), `doesnotexist-${randomUUID()}`);
    expect(result).toEqual({ state: "not_found" });
  });
});
