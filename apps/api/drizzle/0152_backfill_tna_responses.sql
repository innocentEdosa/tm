-- One-time data migration for tenants that already have TNA activity: moves any existing
-- tna_response custom_field_values off their old entityId (a tna_assignments.id, the only entity
-- this form ever wrote against before this feature) onto a brand-new tna_responses row, so no
-- previously captured answer becomes orphaned by the entityId scheme change.
--
-- A 'submitted' assignment gets one 'submitted' tna_responses row (submittedAt copied from the
-- assignment, which used to record its one-and-only response's submission time). A still-'pending'
-- assignment that had already saved a draft (i.e. has at least one matching custom_field_values row)
-- gets one 'draft' row instead, so in-progress work isn't lost. An assignment with neither (the
-- participant never opened the form) gets no row at all — its first tna_responses row is created
-- lazily the first time they actually start.
WITH submitted_responses AS (
  INSERT INTO tna_responses (tenant_id, tna_assignment_id, status, submitted_at, created_at, updated_at)
  SELECT tenant_id, id, 'submitted', submitted_at, created_at, updated_at
  FROM tna_assignments
  WHERE status = 'submitted'
  RETURNING id, tna_assignment_id
),
draft_responses AS (
  INSERT INTO tna_responses (tenant_id, tna_assignment_id, status, created_at, updated_at)
  SELECT DISTINCT a.tenant_id, a.id, 'draft', a.created_at, a.updated_at
  FROM tna_assignments a
  WHERE a.status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM custom_field_values cfv
      JOIN form_fields ff ON ff.id = cfv.field_id
      JOIN form_definitions fd ON fd.id = ff.form_definition_id
      WHERE fd.key = 'tna_response' AND cfv.entity_id = a.id
    )
  RETURNING id, tna_assignment_id
),
all_new_responses AS (
  SELECT id, tna_assignment_id FROM submitted_responses
  UNION ALL
  SELECT id, tna_assignment_id FROM draft_responses
)
UPDATE custom_field_values cfv
SET entity_id = r.id
FROM all_new_responses r
WHERE cfv.entity_id = r.tna_assignment_id
  AND cfv.field_id IN (
    SELECT ff.id FROM form_fields ff
    JOIN form_definitions fd ON fd.id = ff.form_definition_id
    WHERE fd.key = 'tna_response'
  );
