import { PageHeader } from "@tm/ui";

// Shared "more to come" empty state (spec FR-003) — identical for every role. Real per-role
// dashboard content (team roster, Training Needs Analysis, approvals, etc.) is deferred to a later
// spec (spec.md Clarifications, 2026-07-04); this is deliberately not fabricated data of any kind.
export default function DashboardHomePage() {
  return (
    <PageHeader
      title="Welcome to your dashboard"
      subtitle="This is where your day-to-day tools will live. We're still building this out — check back soon."
    />
  );
}
