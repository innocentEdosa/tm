# Quickstart: File Upload & Storage

Validates this feature end-to-end via the API directly (no web UI ships in this spec — Constitution
Alignment). Assumes a local dev stack (`docker-compose up`, migrations applied) with real Cloudflare R2
credentials configured (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
in `apps/api/.env`) and an authenticated tenant session holding `course.manage`.

## Prerequisites

1. Migrations applied (`pnpm --filter api db:migrate`), including this feature's new `file_attachments`
   table.
2. An existing content item (spec 024's `POST /tenant/modules/:moduleId/content-items`) to attach a
   file to — `$CONTENT_ITEM_ID`.
3. A small local test file, e.g. `test.pdf`.

## Scenario 1 — Request an upload URL and upload directly to R2 (User Story 1)

```bash
RESPONSE=$(curl -s -X POST "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/attachments" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "fileName": "test.pdf", "contentType": "application/pdf", "sizeBytes": 12345 }')
echo "$RESPONSE"
ATTACHMENT_ID=$(echo "$RESPONSE" | jq -r '.data.id')
UPLOAD_URL=$(echo "$RESPONSE" | jq -r '.data.uploadUrl')

curl -X PUT "$UPLOAD_URL" -H "Content-Type: application/pdf" --data-binary @test.pdf
```
**Expected**: First call → `201`, a `pending` attachment id and a presigned upload URL. Second call
(the raw PUT to R2, not through the API) → `200`, confirmed by checking the R2 bucket console/CLI
directly if desired.

## Scenario 2 — Confirm the upload (User Story 1)

```bash
curl -X POST "$API_BASE/tenant/attachments/$ATTACHMENT_ID/confirm" -H "Cookie: $SESSION_COOKIE"
```
**Expected**: `200`, `status: "ready"`. Retrying Scenario 1's confirm step *without* actually PUTting
the file first (on a fresh attachment id) should instead return `409`.

## Scenario 3 — List and download (User Story 2 & 3)

```bash
curl "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/attachments" -H "Cookie: $SESSION_COOKIE"

curl "$API_BASE/tenant/attachments/$ATTACHMENT_ID/download-url" -H "Cookie: $SESSION_COOKIE"
```
**Expected**: First call → `200`, the confirmed attachment appears (any still-`pending` ones don't).
Second call → `200`, a presigned download URL; fetching that URL directly returns the original file's
bytes unchanged.

## Scenario 4 — Reject an out-of-allowlist upload (SC-005)

```bash
curl -X POST "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/attachments" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "fileName": "malware.exe", "contentType": "application/x-msdownload", "sizeBytes": 1000 }'
```
**Expected**: `422` — rejected before any R2 interaction; no attachment row is created.

## Scenario 5 — Delete (User Story 4)

```bash
curl -X DELETE "$API_BASE/tenant/attachments/$ATTACHMENT_ID" -H "Cookie: $SESSION_COOKIE"

curl "$API_BASE/tenant/attachments/$ATTACHMENT_ID/download-url" -H "Cookie: $SESSION_COOKIE"
```
**Expected**: First call → `200`. Second call → `404` (both the record and the R2 object are gone).

## Scenario 6 — Tenant isolation and permission gating (SC-002/SC-003)

```bash
# As a user in a DIFFERENT tenant:
curl "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/attachments" -H "Cookie: $OTHER_TENANT_SESSION_COOKIE"
# Expected: 404

# As a user holding neither course.view nor course.manage:
curl "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/attachments" -H "Cookie: $NO_PERMISSION_SESSION_COOKIE"
# Expected: 403
```

## Automated coverage

The scenarios above are each backed by a corresponding integration test under
`apps/api/tests/integration/attachment-*.test.ts` (tasks.md), run via `pnpm --filter api test`, using
`RecordingStorageClient` (research.md §9) in place of real R2 calls — no real Cloudflare credentials are
needed to run the automated suite, only for this manual quickstart walkthrough against a live bucket.
