import { randomBytes } from "node:crypto";

/**
 * A system-generated password for the console's password-reset action (spec FR-009,
 * research.md §4). Deliberately the same underlying primitive as `tenant-auth/otp.ts`'s
 * `generateOneTimePassword` (a short, URL-safe-encoded random string), duplicated locally under an
 * accurately-named function rather than imported cross-module: unlike an OTP, this password is not
 * tied to `otpExpiresAt` and the member is not forced to change it (spec Clarifications) — it is a
 * permanent credential, not a one-time one.
 */
export function generateResetPassword(): string {
  return randomBytes(9).toString("base64url");
}
