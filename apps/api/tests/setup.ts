import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * No dotenv dependency (Principle XII) — a `.env.test` file (gitignored, like all `.env*` files)
 * overrides these hardcoded defaults, which already match `docker-compose.yml`'s local Postgres
 * container so `pnpm --filter api test` works out of the box against `docker compose up postgres`.
 */
const defaults: Record<string, string> = {
  DATABASE_URL: "postgresql://tm:tm_password@localhost:5433/tm_dev",
  APP_DATABASE_URL: "postgresql://tm_app:tm_app_password@localhost:5433/tm_dev",
};

const envTestPath = join(__dirname, "..", ".env.test");
const overrides: Record<string, string> = {};
if (existsSync(envTestPath)) {
  for (const line of readFileSync(envTestPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    overrides[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
}

for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
