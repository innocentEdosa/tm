import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Password hashing via `node:crypto`'s `scrypt` — a memory/CPU-hard KDF, not a general-purpose
 * hash, deliberately expensive to brute-force (spec FR-003; research.md §1). Encodes the random
 * salt alongside the derived key as `<saltHex>:<keyHex>` so no separate column is needed.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

/**
 * Re-derives the key from the submitted password using the stored salt and compares it against the
 * stored key with `crypto.timingSafeEqual`, avoiding a timing side-channel on the comparison itself
 * (research.md §9).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const storedKey = Buffer.from(keyHex, "hex");
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}

/**
 * A fixed, pre-computed hash with no real corresponding password — used to run a dummy
 * `verifyPassword` call when a submitted login email isn't found, so response timing doesn't
 * distinguish "wrong password" from "unknown email" (research.md §9).
 */
export const DUMMY_PASSWORD_HASH =
  "00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
