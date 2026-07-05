import { getPlatformSession } from "@/lib/platform-session";

// Server Component — the shell's home content (spec FR-005). The layout already guarantees a valid
// session before this renders, so there's no loading/unauthenticated/error state to manage here
// (unlike the pre-shell version of this page, which fetched client-side and handled all of that
// itself).
export default async function PlatformHomePage() {
  const session = await getPlatformSession();
  if (!session.authenticated) {
    return null;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="banner-success">You&apos;re authenticated as a platform Super Admin.</div>

      <h1 className="mt-6 text-3xl font-bold tracking-tight text-primary">{session.name}</h1>
      <div className="surface-card mt-4">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Email</dt>
            <dd className="text-right text-text">{session.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Last login</dt>
            <dd className="text-right text-text">{session.lastLoginAt ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Super Admin flag (RLS indicator)</dt>
            <dd className="text-right text-text">
              {session.isSuperAdminFlagSet ? "Set" : "Not set"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
