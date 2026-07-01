import { describe, expect, it } from "vitest";
import { resolveEffectivePermissions } from "../../src/permissions/effective-permissions";

describe("resolveEffectivePermissions (pure, no DB)", () => {
  it("returns an empty set for zero roles (deny by default, FR-010)", () => {
    expect(resolveEffectivePermissions([])).toEqual([]);
  });

  it("returns a single role's permissions unchanged", () => {
    expect(
      resolveEffectivePermissions([{ permissionKeys: ["approve_enrollment", "manage_roles"] }]),
    ).toEqual(["approve_enrollment", "manage_roles"]);
  });

  it("unions permissions across multiple roles without duplicates", () => {
    const result = resolveEffectivePermissions([
      { permissionKeys: ["approve_enrollment"] },
      { permissionKeys: ["approve_enrollment", "view_department_analytics"] },
      { permissionKeys: ["manage_roles"] },
    ]);
    expect(new Set(result)).toEqual(
      new Set(["approve_enrollment", "view_department_analytics", "manage_roles"]),
    );
    expect(result.length).toBe(3);
  });

  it("handles roles with empty permission sets", () => {
    expect(
      resolveEffectivePermissions([{ permissionKeys: [] }, { permissionKeys: ["manage_roles"] }]),
    ).toEqual(["manage_roles"]);
  });
});
