import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Db } from "./client";

let pool: Pool | undefined;

/**
 * Bound to `tm_platform_reader` (BYPASSRLS, SELECT-only on `roles`/`user_roles`) — used ONLY by
 * `isSuperAdmin` (require-platform-permission.ts). See drizzle/README.md "Platform-reader role".
 */
export function getPlatformReaderDb(): Db {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.PLATFORM_READER_DATABASE_URL, max: 2 });
  }
  return drizzle(pool);
}
