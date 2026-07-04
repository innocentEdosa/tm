// Next.js's global not-found boundary. Renders both for genuinely unmatched routes and, via
// app/_not-found-trigger/page.tsx, for unclaimed/reserved/invalid-subdomain requests rewritten here
// by middleware.ts (spec 004 FR-007, US3). Same minimal design posture as every prior UI surface
// (constitution Principle V).
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">Page not found</h1>
      <p className="mt-2 text-sm text-gray-600">
        Nothing lives at this address. Check the URL, or contact whoever gave it to you.
      </p>
    </main>
  );
}
