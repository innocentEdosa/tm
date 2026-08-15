import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { platformSettings } from "../db/schema/platform-settings";
import { requireSuperAdminSession } from "../platform-auth/require-super-admin-session";

const THEME_SETTING_KEY = "active_theme";
export const THEMES = ["violet", "navy"] as const;
export type Theme = (typeof THEMES)[number];

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** `DEFAULT_THEME` seeds the theme the very first time this deploys, before any Super Admin has
 * ever written a `platform_settings` row — an unset/unrecognized value falls back to "navy"
 * (today's design-system default), never throws. */
function defaultTheme(): Theme {
  return isTheme(process.env.DEFAULT_THEME) ? process.env.DEFAULT_THEME : "navy";
}

/** UI Theme Switching — global, platform-controlled (not per-tenant). `GET` is intentionally public:
 * every page render (tenant, platform, and logged-out) needs this to pick `<html data-theme>` before
 * paint, and the theme name itself isn't tenant-confidential data, matching tenant-routing's own
 * "public, unauthenticated" posture (tenant-routing-routes.ts). `PATCH` is Super-Admin-only —
 * gates purely on `requireSuperAdminSession`, no `permissions` row, matching every other
 * Super-Admin-only surface in this codebase (platform-form-routes.ts). */
const themeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/platform/theme", async (_request, reply) => {
    const [row] = await fastify.db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, THEME_SETTING_KEY));

    const theme = row && isTheme(row.value) ? row.value : defaultTheme();
    return reply.code(200).send({ success: true, data: { theme } });
  });

  fastify.patch<{ Body: { theme?: string } }>(
    "/platform/theme",
    { preHandler: [requireSuperAdminSession] },
    async (request, reply) => {
      const { theme } = request.body ?? {};
      if (!isTheme(theme)) {
        return reply.code(400).send({ success: false, message: `theme must be one of: ${THEMES.join(", ")}` });
      }

      await fastify.db
        .insert(platformSettings)
        .values({ key: THEME_SETTING_KEY, value: theme, updatedBySuperAdminId: request.superAdmin!.id })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: { value: theme, updatedAt: new Date(), updatedBySuperAdminId: request.superAdmin!.id },
        });

      return reply.code(200).send({ success: true, data: { theme } });
    },
  );
};

export default themeRoutes;
