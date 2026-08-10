-- Form Builder spec (033) — non-destructive backfill (data-model.md "Migration Sequencing" step
-- 5). For every existing `form_definitions` row (`department`, `member`,
-- `training_needs_analysis` as of this migration — written generically over "every row lacking
-- an active version" rather than hardcoding those three keys, so it also covers any form type
-- added between 0030/0041/0048 and this migration without needing an edit):
--   1. Insert a `version_number = 1, status = 'published'` row — this form type's fields become
--      immediately consumable via `getEffectiveForm`, exactly as they already were via
--      `getFormFields` before this spec (spec FR-033/FR-034 — no consumer sees any change from
--      this migration alone).
--   2. Insert one default section (`key = 'general'`) — every pre-existing field lands somewhere
--      (spec's "zero configured steps/sections renders exactly as before" edge case, satisfied
--      by "one implicit section" rather than a genuinely empty layout).
--   3. Point `form_definitions.active_version_id` at the new version.
--   4. Backfill every existing `form_fields` row's placement: platform rows (`tenant_id IS
--      NULL`) get both `form_version_id` and `form_section_id`; tenant-owned rows get only
--      `form_section_id` (they are never version-scoped — data-model.md).
-- Guarded by `WHERE active_version_id IS NULL` so this is safe to reason about as idempotent —
-- it only ever touches a form type that has never been versioned yet.
DO $$
DECLARE
  def RECORD;
  new_version_id uuid;
  new_section_id uuid;
BEGIN
  FOR def IN SELECT id FROM form_definitions WHERE active_version_id IS NULL LOOP
    INSERT INTO form_versions (form_definition_id, version_number, status, published_at)
    VALUES (def.id, 1, 'published', now())
    RETURNING id INTO new_version_id;

    INSERT INTO form_sections (form_version_id, form_step_id, key, title, display_order)
    VALUES (new_version_id, NULL, 'general', 'General', 0)
    RETURNING id INTO new_section_id;

    UPDATE form_definitions
    SET active_version_id = new_version_id, updated_at = now()
    WHERE id = def.id;

    UPDATE form_fields
    SET form_version_id = new_version_id, form_section_id = new_section_id
    WHERE form_definition_id = def.id AND tenant_id IS NULL;

    UPDATE form_fields
    SET form_section_id = new_section_id
    WHERE form_definition_id = def.id AND tenant_id IS NOT NULL;
  END LOOP;
END $$;
