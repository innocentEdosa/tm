"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * AI page context — the frontend counterpart of `apps/api/src/ai/routes.ts`'s
 * `buildSystemPrompt(context)`. Narrowly scoped, mirroring `lib/subdomain-context.tsx`'s pattern
 * rather than a global app-wide store: most of the app never needs this, and the handful of places
 * that do are far apart in the tree.
 *
 * IMPORTANT: this is a UX convenience only. These fields only ever bias which form/course the
 * assistant assumes "this form"/"this course" refers to in its own reply — they're sent to the
 * backend as plain hint strings folded into that turn's system prompt, never as authorization, and
 * no tool call executes against an entity the model didn't explicitly choose in its own tool-call
 * arguments. The backend independently re-derives tenant/user/permissions from the session on every
 * request regardless of what this context says (see `docs/ai-foundation-architecture.md` §2–3).
 * Changing this context can change what the assistant *talks about* — never what it's *allowed to
 * do*.
 */
export interface AiPageContextValue {
  formKey?: string;
  courseId?: string;
}

interface AiPageContextApi {
  value: AiPageContextValue;
  setValue: (value: AiPageContextValue) => void;
}

const AiPageContext = createContext<AiPageContextApi>({ value: {}, setValue: () => {} });

/**
 * Two ways to feed this provider, because its one `AiAssistantLauncher` consumer sits in two
 * different positions in the tree depending on the page:
 *
 * - `value` (static): the standalone Forms Builder page mounts its own dedicated
 *   `AiAssistantLauncher` as a *descendant* of this provider, so a plain prop works.
 * - omitted (dynamic): the dashboard shell mounts one `AiPageContextProvider` wrapping both
 *   `{children}` (every dashboard page) and its single shared `AiAssistantLauncher` as *siblings* —
 *   a page deep in `{children}` can't hand a value down to a sibling via props, so it calls
 *   `useSetAiPageContext` instead, which publishes into this provider's own internal state.
 */
export function AiPageContextProvider({ value, children }: { value?: AiPageContextValue; children: React.ReactNode }) {
  const [dynamicValue, setDynamicValue] = useState<AiPageContextValue>({});
  return <AiPageContext.Provider value={{ value: value ?? dynamicValue, setValue: setDynamicValue }}>{children}</AiPageContext.Provider>;
}

export function useAiPageContext(): AiPageContextValue {
  return useContext(AiPageContext).value;
}

/** Called by a descendant page (e.g. the course editor) to publish its own page context into a
 * dynamic-mode `AiPageContextProvider` — e.g. `useSetAiPageContext({ courseId })` so the assistant
 * resolves "this course" without the user naming it. Clears itself on unmount so navigating away
 * doesn't leave stale context active for the next page. No-op (harmlessly) under a static-mode
 * provider, since that provider ignores its own internal state in favor of the given `value`. */
export function useSetAiPageContext(value: AiPageContextValue): void {
  const { setValue } = useContext(AiPageContext);
  const key = JSON.stringify(value);
  useEffect(() => {
    setValue(JSON.parse(key));
    return () => setValue({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
