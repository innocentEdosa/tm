/**
 * data-model.md "Derived concept: effective permissions" — the set union of every permission key
 * reachable through any role a user holds. Zero roles -> empty set (deny by default, FR-010).
 */
export function resolveEffectivePermissions(roles: { permissionKeys: string[] }[]): string[] {
  const union = new Set<string>();
  for (const role of roles) {
    for (const key of role.permissionKeys) {
      union.add(key);
    }
  }
  return Array.from(union);
}
