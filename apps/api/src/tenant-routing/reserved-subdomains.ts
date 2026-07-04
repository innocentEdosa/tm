/**
 * The single canonical reserved-subdomain list (spec 004 FR-005) — consulted both by tenant routing
 * (`resolve-tenant.ts`, this feature) and by provisioning (`provisioning/provision-tenant.ts`, Spec 2
 * FR-016), so the two never drift into two independently-maintained lists. Fixed platform-wide, not
 * tenant-configurable — changes are a reviewed code change, not a per-tenant setting.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "www",
  "api",
  "app",
  "admin",
  "mail",
  "ftp",
  "smtp",
  "imap",
  "pop",
  "ns1",
  "ns2",
  "static",
  "cdn",
  "assets",
  "help",
  "support",
  "status",
  "docs",
  "blog",
  "dev",
  "staging",
  "test",
  "platform",
  "portal",
  "dashboard",
  "login",
  "auth",
  "billing",
  "security",
  "webmail",
];

export function isReservedSubdomain(label: string): boolean {
  return RESERVED_SUBDOMAINS.includes(label.toLowerCase());
}
