import { createHash, randomBytes } from "node:crypto";

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours (spec Assumptions)

/** Raw session token — this is the only place the raw value exists outside the browser's cookie
 * jar; the database only ever stores `hashSessionToken`'s output (research.md §2). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** `sha256` hex digest of a raw token, used both to store and to look up sessions — mirrors never
 * storing a plaintext password (research.md §2). */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiryFromNow(): Date {
  return new Date(Date.now() + SESSION_DURATION_MS);
}
