"use client";

import { createContext, useContext } from "react";

/**
 * AI page context, first version (Forms only) — the frontend counterpart of
 * `apps/api/src/ai/routes.ts`'s `buildSystemPrompt(context)`. Narrowly scoped, mirroring
 * `lib/subdomain-context.tsx`'s pattern rather than a global app-wide store: most of the app never
 * needs this, and the handful of places that do (currently just the Forms Builder page) are far
 * apart in the tree.
 *
 * IMPORTANT: this is a UX convenience only. `formKey` here only ever biases which form the
 * assistant assumes "this form" refers to in its own reply — it is sent to the backend as a plain
 * hint string folded into that turn's system prompt, never as authorization, and no tool call
 * executes against a form the model didn't explicitly choose in its own tool-call arguments. The
 * backend independently re-derives tenant/user/permissions from the session on every request
 * regardless of what this context says (see `docs/ai-foundation-architecture.md` §2–3). Changing
 * this context can change what the assistant *talks about* — never what it's *allowed to do*.
 */
export interface AiPageContextValue {
  formKey?: string;
}

const AiPageContext = createContext<AiPageContextValue>({});

export function AiPageContextProvider({ value, children }: { value: AiPageContextValue; children: React.ReactNode }) {
  return <AiPageContext.Provider value={value}>{children}</AiPageContext.Provider>;
}

export function useAiPageContext(): AiPageContextValue {
  return useContext(AiPageContext);
}
