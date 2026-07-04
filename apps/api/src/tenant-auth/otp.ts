import { randomBytes } from "node:crypto";

const OTP_VALIDITY_MS = 72 * 60 * 60 * 1000; // 72 hours

/**
 * A one-time password (research.md §6) — a short, URL-safe-encoded random string. Hashed and stored
 * in the same `users.password_hash` column as a real password (data-model.md); login verification
 * has no separate code path for "is this an OTP."
 */
export function generateOneTimePassword(): string {
  return randomBytes(9).toString("base64url");
}

export function otpExpiryFromNow(): Date {
  return new Date(Date.now() + OTP_VALIDITY_MS);
}
