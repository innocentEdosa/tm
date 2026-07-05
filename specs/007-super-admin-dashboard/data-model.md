# Data Model: Super Admin Platform Dashboard Shell

No new tables, columns, or migrations. No changes to `apps/api` at all (research.md §1). This feature
reads existing data only, through existing, unmodified endpoints.

## Existing entities read by this feature

### Super Admin identity (existing, Super Admin Authentication spec)

Read via the existing, unmodified `GET /platform/me` — `{ id, email, name, lastLoginAt,
isSuperAdminFlagSet }`. Populates the shell's Home view and the sidebar's role-badge initial (first
letter of `name`), mirroring how the tenant shell derives its badge from `roleName`.

### Provisioned tenant (existing, Tenant Provisioning Core spec)

Created via the existing, unmodified `POST /provisioning/tenants`. This feature relocates and
restyles the wizard that calls it; the request/response shape and validation are untouched.

### Permission / role-template catalog (existing, Roles & Permissions Model spec)

Read via the existing, unmodified `GET /admin/permissions` and `GET /admin/role-templates`. This
feature relocates and restyles the view of this data; nothing about what's fetched or how changes.

## Derived concept (not a table): Sidebar entry structure

Static, not derived from any permission check (research.md §5) — every authenticated Super Admin sees
the same structure:

| Entry | Destination | Panel? |
|---|---|---|
| Home | `/platform` | none — direct link |
| Platform Tools | *(category only, no destination of its own)* | opens a panel |
| — Provision Tenant | `/provisioning/new` | *(item within Platform Tools)* |
| — Permissions | `/admin/permissions` | *(item within Platform Tools)* |
