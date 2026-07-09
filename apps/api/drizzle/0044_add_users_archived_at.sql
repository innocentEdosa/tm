-- Add/Edit Team Member spec (013): adds the archive capability requested for the member list's
-- Actions menu. NULL means active; a non-null timestamp blocks login (tenant-auth-routes.ts,
-- tenant-user-context.ts) and hides the member from the default directory list
-- (GET /tenant/team, unless includeArchived=true is passed).
ALTER TABLE "users" ADD COLUMN "archived_at" timestamp with time zone;
