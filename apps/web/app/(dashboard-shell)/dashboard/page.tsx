// Shared "more to come" empty state (spec FR-003) — identical for every role. Real per-role
// dashboard content (team roster, Training Needs Analysis, approvals, etc.) is deferred to a later
// spec (spec.md Clarifications, 2026-07-04); this is deliberately not fabricated data of any kind.
export default function DashboardHomePage() {
  return (
    <div className="mx-auto max-w-2xl py-12 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-primary">Welcome to your dashboard</h1>
      <p className="mt-3 text-sm text-slate-600">
        This is where your day-to-day tools will live. We&apos;re still building this out — check
        back soon.
      </p>
    </div>
  );
}
