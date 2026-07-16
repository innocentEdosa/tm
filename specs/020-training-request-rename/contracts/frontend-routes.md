# Contract: Frontend Routes

This documents the web route contract change for the Training Request feature's pages
(`apps/web/app/(dashboard-shell)/learning/...`).

## Before → After

| Purpose | Old path | New path |
|---|---|---|
| List | `/learning/tna` | `/learning/training-requests` |
| Create | `/learning/tna/new` | `/learning/training-requests/new` |
| View one entry | `/learning/tna/:id` | `/learning/training-requests/:id` |
| Edit one entry | `/learning/tna/:id/edit` | `/learning/training-requests/:id/edit` |

`:id` is the same record identifier in both columns — no record's identity or URL segment shape
changes, only the fixed `tna` segment becomes `training-requests`.

## Redirect guarantee

Every old path (list, create, view, edit — any path matching `/learning/tna/:path*`) issues a
temporary (307) redirect to its corresponding new path via a single `redirects()` rule in
`apps/web/next.config.ts` (research.md §4). A user opening an old bookmarked or shared link lands on
the same record's new-path page with no broken-link error (spec FR-006, User Story 3, SC-003).

## Nav entry

The "Learning" section's child nav item (`apps/web/app/(dashboard-shell)/layout.tsx`) updates its
`href` from `/learning/tna` to `/learning/training-requests` and its `label` from
"Training Needs Analysis" to "Training Requests" (research.md §3), gated on the same renamed
permission set (see `permission-keys.md`) with identical gating logic — a user who could see the
nav entry before the rename can see it after, and vice versa.

## What does not change

- The backend API route prefix `/tenant/training-needs` (`apps/api/src/training-needs/tenant-training-needs-routes.ts`)
  is unchanged — this is an internal API contract, not a user-facing web address, and is explicitly
  out of scope per the spec's Assumptions.
- The dynamic segment's underlying param name (`trainingNeedId`) is unchanged — internal, not
  user-facing.
