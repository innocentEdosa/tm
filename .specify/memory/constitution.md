<!--
Sync Impact Report
Version change: 1.0.0 → 1.1.0
Modified principles: N/A (no existing principle redefined)
Added sections:
  - Development Workflow (new principle X: branch hygiene — clean working tree before starting a
    new feature branch, one branch per spec)
Removed sections: N/A
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no changes needed (Constitution Check gate is already generic and reads from this file)
  - .specify/templates/spec-template.md ✅ already updated in a prior amendment with a Constitution
    Alignment checklist; no further change needed for this workflow principle (it governs branch/repo
    hygiene, not spec content)
  - .specify/templates/tasks-template.md ✅ no changes needed (task categorization is generic)
  - .specify/scripts/bash/create-new-feature.sh ⚠ pending — this script computes a branch name and
    feature directory but does not itself check for a clean working tree or create/checkout the git
    branch. Flagged for a follow-up change so branch creation actually enforces Principle X; not
    modified in this run since it is an operational script, not a template.
  - No command files or CLAUDE.md/README.md exist yet in this repo to reconcile
Follow-up TODOs:
  - None blocking.
-->

# TM Constitution

## Project Identity

TM is a multi-tenant SaaS Learning Management System for HR and L&D teams, serving multiple client
organizations on shared infrastructure. It provides AI-assisted course generation, gamification,
5-level Kirkpatrick evaluation (Reaction, Learning, Behaviour, Results, ROI), budget tracking, manager
dashboards, and a Super Admin console for platform operators. Its audience is HR/L&D admins, managers,
and employee learners across multiple tenant organizations.

TM is a platform product, not a bespoke build for a single client. Every feature MUST be built
tenant-aware from day one. The person approving milestones is non-technical, so specs, plans, and
demos MUST be explainable in plain English, not just technically correct.

## Core Principles

### I. Tenant Isolation Is a Security Requirement, Not a Feature

Every table, query, and API call MUST be scoped by `tenant_id` and validated server-side, regardless
of what the client sends. No cross-tenant data access is acceptable under any circumstance, including
during rapid AI-assisted development. Application code MUST NOT assume single-tenant context anywhere
in the stack — not in a "temporary" script, a background job, an admin tool, or a demo shortcut.

**Rationale**: A single cross-tenant leak destroys trust across the entire customer base at once, not
just for one tenant. Isolation must be enforced at the data layer, not merely hoped for at the UI layer.

### II. Tenant Provisioning Includes Org Structure, Not Just an Account

Onboarding a new company is not just creating a login — it means provisioning their departments,
roles, and permission sets as first-class configurable data, not fixed enums baked into the schema.
Provisioning MUST support default department/role templates for fast setup, plus full per-tenant
customization on top of those defaults: a company MUST be able to rename, add, remove, or restructure
departments and permission levels without requiring a code change.

**Rationale**: Every client organization has a different org chart and approval hierarchy. Hardcoding
structure forces a code change per customer, which does not scale as a platform.

### III. Forms and Flows Are Tenant-Configurable, Not One-Size-Fits-All

Different companies require different intake forms, approval flows, and field sets even when a
sensible default exists (e.g. TNA input fields, enrollment approval chains, onboarding
questionnaires). Every form/flow in the system MUST be built on a schema that supports per-tenant
field and step overrides — never hardcode a form layout or approval sequence as globally fixed.
Defaults exist to speed up onboarding, not to cap what a tenant can configure later.

**Rationale**: If defaults become ceilings instead of starting points, every subsequent customer
request for a custom field or approval step becomes a code change instead of a configuration change.

### IV. Spec-Before-Code, Always

No feature moves to implementation without a written spec (via speckit) covering user roles, data
model impact, tenant-scoping implications, configurability requirements (per Principles II and III),
and plan-tier gating. Ambiguity MUST be resolved in the spec, not invented in code.

**Rationale**: In a multi-tenant platform, decisions made silently in code (what's configurable, what's
shared, what's isolated) are expensive to reverse later and invisible to the non-technical stakeholder
approving the work.

### V. Design Decisions Are Delegated to the UI-UX-Pro-Max Skill, Then Locked

Visual identity (color palette, typography, spacing, component style) has not yet been fixed. Claude,
using the UI-UX-Pro-Max skill, is responsible for proposing and establishing this design system during
early design work. Once established, the resulting system becomes the binding standard: all subsequent
screens MUST be built against it using the same skill, with no ad hoc palettes, fonts, or component
styles introduced per-feature. Deviations require an explicit design-system update, not a one-off
exception.

**Rationale**: A platform serving many tenants needs one coherent internal design language (distinct
from tenant white-label branding, see Principle VII) so screens stay consistent and maintainable as the
product grows.

### VI. Every Module Is Plan-Tier Aware

Starter / Growth / Enterprise tiers gate functionality (e.g. AI Course Generation, full 5-level
Kirkpatrick, custom branding are Growth/Enterprise only). Features MUST be built behind tenant-level
feature flags evaluated at runtime, never hardcoded as globally available.

**Rationale**: Plan-tier gating is a revenue and packaging mechanism. If it is bolted on after a
feature ships instead of designed in from the start, tier boundaries become inconsistent and easy to
bypass.

### VII. White-Labeling and Structural Customization Go Together

No tenant-specific branding, department structure, permission set, form, or flow is ever hardcoded into
a shared component. Logo, colors, subdomain, org structure, and workflow configuration MUST all be
runtime-configurable per tenant from the start.

**Rationale**: Branding and structural configuration are both expressions of the same underlying need —
letting each tenant look and operate like their own organization on shared infrastructure. Solving only
one half (e.g. logos but not org structure) leaves the platform half-finished for enterprise buyers.

### VIII. Comprehensive-Version Rule Carries Forward

Where future specs surface conflicting scope (e.g. two source docs, or a stakeholder request vs. an
existing spec), default to the more complete version unless a stakeholder explicitly narrows scope.
Flag the tradeoff rather than silently picking the smaller option.

**Rationale**: Silently choosing the smaller scope hides a decision the stakeholder should get to make.
Defaulting to the more complete version and flagging it keeps that decision visible and reversible.

### IX. Demoable vs. Internal Work Is Explicit

Every spec MUST state whether its output is stakeholder-demoable or internal/infrastructure-only, so
delivery communication stays honest with a non-technical audience.

**Rationale**: A non-technical stakeholder judges progress by what they can see. Conflating "done" with
"demoable" erodes trust when infrastructure work (correctly) produces nothing visible.

## Development Workflow

### X. Every Feature Starts in a New Branch, from a Clean Working Tree

No feature work begins on a branch that has uncommitted or pending changes waiting to merge. Before
creating a new feature branch, all prior work MUST be either merged, committed and pushed, or
explicitly stashed with intent to return to it. This applies even under fast, AI-assisted iteration —
speed is not a reason to stack unrelated changes on top of an unmerged branch. Each spec (via speckit)
maps to its own branch; branches are not reused across unrelated features.

**Rationale**: Stacking unrelated changes onto an unmerged branch makes it impossible to review, ship,
or roll back one feature without dragging in another. A clean starting point per spec keeps each
feature independently reviewable and deployable — the same independence Principle IV expects at the
spec level.

## Quality Bar

- Data model changes MUST state their tenant-isolation model impact (shared schema w/ RLS,
  schema-per-tenant, or dedicated DB) even if the answer is "no change."
- Any feature involving departments, roles, permissions, forms, or approval flows MUST state which
  parts are tenant-configurable and which (if any) are intentionally fixed platform-wide, with a
  reason.
- Any AI-generation feature (course content, etc.) MUST specify its review/approval step before
  content is considered "published" — no direct-to-live AI output.
- Kirkpatrick L4/L5 (Results/ROI) features MUST state their data source and calculation method
  explicitly; no feature may claim ROI without a defined formula.
- Security, budget, and evaluation modules MUST include an explicit "what happens on tenant
  downgrade/cancellation" note.
- Any new UI screen MUST reference the established design system (once locked, per Principle V) or
  explicitly flag that it's proposing a design-system change.

## Governance

This constitution supersedes convenience decisions made during any single feature spec. If a spec
conflicts with a principle here, the spec MUST either be revised or the constitution amended
explicitly — never silently overridden.

**Amendment procedure**: Amendments require a stated reason and are logged via an updated Sync Impact
Report (prepended to this file) at the time of the change — never edited in place without a record of
what changed and why.

**Versioning policy**: This constitution follows semantic versioning:
- **MAJOR**: Backward-incompatible governance changes or removal/redefinition of a principle.
- **MINOR**: A new principle or materially expanded guidance is added.
- **PATCH**: Clarifications, wording, or typo fixes that do not change meaning.

**Compliance review**: Every spec and plan produced under `speckit` MUST be checked against the Core
Principles, Development Workflow, and Quality Bar above before moving to implementation. Any unresolved
conflict blocks implementation until resolved per the amendment procedure or the spec is revised.

**Version**: 1.1.0 | **Ratified**: 2026-07-01 | **Last Amended**: 2026-07-01
