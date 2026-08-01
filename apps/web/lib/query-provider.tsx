"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * One QueryClient per browser tab (not per render) — created lazily inside useState so it survives
 * re-renders of this provider without being recreated, but a fresh client is still made per mount
 * (server-render safe, no cross-request cache leakage since this only ever runs client-side).
 *
 * `staleTime` defaults to 0 in React Query, which means every remount (e.g. navigating away from
 * /settings/team and back) refetches immediately — exactly the "fetch every time" behavior this
 * migration is meant to fix. 30s keeps admin/settings data fresh enough while still letting the
 * cache actually do its job between navigations within a session.
 */
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
