# Quickstart: SCORM 1.2 Runtime

Validates this feature end-to-end. Unlike specs 023-026, this one has a real UI surface — full
end-to-end validation means both API calls (via `curl`) and a browser check of the launcher page.
Assumes a local dev stack (`docker-compose up`, migrations applied), an authenticated tenant session
holding `course.manage` (`$SESSION_COOKIE`) and one holding only `course.view`
(`$LEARNER_SESSION_COOKIE`), and a minimal valid SCORM 1.2 test package (`test-package.zip` — a single
`imsmanifest.xml` plus one `index.html` entry point; a two-SCO variant for Scenario 6).

## Prerequisites

1. Migrations applied (`pnpm --filter api db:migrate`), including this feature's four new tables.
2. An existing content item (spec 024) with `type: "external_import"`, `payload.sourceType: "scorm"` —
   `$CONTENT_ITEM_ID`.
3. A test SCORM 1.2 `.zip` package — built by `tests/unit/fixtures/build-test-scorm-package.ts`
   (`tasks.md`) for automated tests; for manual validation, any minimal valid SCORM 1.2 package works.

## Scenario 1 — Upload and import a single-SCO package (User Story 1)

```bash
RESPONSE=$(curl -s -X POST "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/scorm/upload-url" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "sizeBytes": 51200 }')
UPLOAD_URL=$(echo "$RESPONSE" | jq -r '.data.uploadUrl')
STORAGE_KEY=$(echo "$RESPONSE" | jq -r '.data.storageKey')

curl -X PUT "$UPLOAD_URL" -H "Content-Type: application/zip" --data-binary @test-package.zip

curl -s -X POST "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/scorm/import" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" \
  -d "{ \"storageKey\": \"$STORAGE_KEY\" }"
```
**Expected**: Upload-url call → `201`. Raw PUT to R2 → `200`. Import call → `201`, `data.scos` contains
exactly one entry whose `contentItemId` equals `$CONTENT_ITEM_ID` (single-SCO package — no additional
content items created).

## Scenario 2 — Reject a malformed package (SC-004)

```bash
echo "not a zip" > bad.zip
RESPONSE=$(curl -s -X POST "$API_BASE/tenant/content-items/$OTHER_CONTENT_ITEM_ID/scorm/upload-url" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" -d '{ "sizeBytes": 100 }')
UPLOAD_URL=$(echo "$RESPONSE" | jq -r '.data.uploadUrl')
STORAGE_KEY=$(echo "$RESPONSE" | jq -r '.data.storageKey')
curl -X PUT "$UPLOAD_URL" --data-binary @bad.zip

curl -X POST "$API_BASE/tenant/content-items/$OTHER_CONTENT_ITEM_ID/scorm/import" \
  -H "Cookie: $SESSION_COOKIE" -H "Content-Type: application/json" -d "{ \"storageKey\": \"$STORAGE_KEY\" }"
```
**Expected**: `422` — no `scorm_packages`/`scorm_package_items`/content items created.

## Scenario 3 — Launch data and CMI resume (User Story 2 & 3)

```bash
curl "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/scorm/launch" -H "Cookie: $LEARNER_SESSION_COOKIE"
```
**Expected**: `200`, `data.cmi.entry: "ab-initio"` (first launch), `data.entryPointUrl` resolving to the
file-proxy route.

```bash
curl -X PUT "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/scorm/cmi" \
  -H "Cookie: $LEARNER_SESSION_COOKIE" -H "Content-Type: application/json" \
  -d '{ "status": "incomplete", "bookmark": "page-2", "suspendData": "resume-state", "sessionTimeSeconds": 120 }'

curl "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/scorm/launch" -H "Cookie: $LEARNER_SESSION_COOKIE"
```
**Expected**: Commit → `200`. Second launch call → `200`, `data.cmi.entry: "resume"`, `data.cmi.bookmark:
"page-2"`, `data.cmi.suspendData: "resume-state"`.

## Scenario 4 — Reject over-length suspend data

```bash
curl -X PUT "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/scorm/cmi" \
  -H "Cookie: $LEARNER_SESSION_COOKIE" -H "Content-Type: application/json" \
  -d "{ \"status\": \"incomplete\", \"suspendData\": \"$(printf 'x%.0s' {1..4097})\" }"
```
**Expected**: `400`.

## Scenario 5 — File proxy serves the entry point and its relative assets

```bash
curl -I "$API_BASE$(curl -s "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/scorm/launch" \
  -H "Cookie: $LEARNER_SESSION_COOKIE" | jq -r '.data.entryPointUrl' | sed 's|/tenant-api||')"
```
**Expected**: `200`, `Content-Type: text/html`.

## Scenario 6 — Multi-SCO import and navigation (User Story 4)

Repeat Scenario 1 against a fresh content item using a two-SCO test package.

**Expected**: Import response's `data.scos` contains two entries with `position: 0` and `position: 1`;
the second entry's `contentItemId` is a newly-created content item (not the uploaded-to one), positioned
immediately after it in the module. `GET .../scorm/launch` for either SCO's content item returns
`data.navigation.scos` listing both, in order.

## Scenario 7 — Browser check: launcher page and RTE API discovery

Navigate to `/learning/scorm/$CONTENT_ITEM_ID` as the learner in a real browser. **Expected**: the SCO
loads inside an iframe; opening the browser console and running `window.parent.API` from the iframe's
own context (or observing the SCO's own console output, if it logs API-discovery success) confirms the
RTE API object is found via the standard parent-chain search.

## Scenario 8 — Tenant isolation and permission gating (SC-003)

```bash
# As a user in a DIFFERENT tenant:
curl "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/scorm/launch" -H "Cookie: $OTHER_TENANT_SESSION_COOKIE"
# Expected: 404

# As a user holding neither course.view nor course.manage:
curl "$API_BASE/tenant/content-items/$CONTENT_ITEM_ID/scorm/launch" -H "Cookie: $NO_PERMISSION_SESSION_COOKIE"
# Expected: 403
```

## Automated coverage

The scenarios above are each backed by a corresponding integration test under
`apps/api/tests/integration/scorm-*.test.ts` (tasks.md), run via `pnpm --filter api test`, using
`RecordingStorageClient`'s extended `putObject`/`getObjectStream` and an in-memory-built test `.zip`
fixture — no real R2 credentials or a real browser are needed to run the automated suite. Scenario 7
(real browser RTE API discovery) is the one scenario that requires manual verification, since Vitest's
integration tests exercise the API layer, not a real browser's `window`/iframe chain.
