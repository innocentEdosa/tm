-- Department's Manager/Assistant Manager system fields were seeded with a nominal
-- `field_type = 'text'` (migration 0036 — at the time, `field_type` on a system field was never
-- used for rendering, since department-settings-client.tsx always rendered its own hardcoded
-- PersonPicker regardless). Now that a generic `user_select` field type exists, correct these two
-- rows to the real type across every version (draft/published/archived) so the Platform Forms
-- builder's own canvas and Live Preview show/render them accurately too, and so any future draft
-- cloned from an older archived version also inherits the correct type.
UPDATE "form_fields"
SET "field_type" = 'user_select'
WHERE "field_key" IN ('manager_id', 'assistant_manager_id') AND "is_system" = true;
