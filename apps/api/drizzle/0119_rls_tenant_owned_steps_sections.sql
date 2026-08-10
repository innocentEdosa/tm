-- form_steps/form_sections now carry tenant-owned rows too (0116) — the existing "readable_by_all"
-- policy would leak one tenant's own steps/sections to every other tenant, so it's replaced with
-- the exact same 3-policy shape form_fields already uses: Super Admin full access, platform rows
-- (tenant_id IS NULL) readable by everyone, and a tenant_isolation policy scoping a tenant
-- session's own reads/writes to its own tenant_id.
DROP POLICY "readable_by_all" ON "form_steps";--> statement-breakpoint
DROP POLICY "readable_by_all" ON "form_sections";--> statement-breakpoint

CREATE POLICY "platform_rows_readable" ON "form_steps"
  FOR SELECT
  USING (tenant_id IS NULL);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "form_steps"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

CREATE POLICY "platform_rows_readable" ON "form_sections"
  FOR SELECT
  USING (tenant_id IS NULL);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "form_sections"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
