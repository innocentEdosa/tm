"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Drawer, Toast, type ToastVariant } from "@tm/ui";
import {
  createConversation,
  getConversation,
  listConversations,
  sendMessage,
  confirmToolExecution,
  rejectToolExecution,
  type AiMessage,
} from "@/lib/ai-api-client";
import { useAiPageContext } from "./ai-page-context";
import { ProposalCard } from "./proposal-card";
import { MarkdownMessage } from "./markdown-message";

/** A tiny inline SVG so this component has no new icon-library dependency beyond `lucide-react`
 * (already a dependency via `packages/ui`) — kept local rather than added to `app-shell.tsx`'s
 * `ICONS` registry, since that registry is for *nav* icons, not this floating trigger. */
function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2l1.8 5.6L19.4 9.4 13.8 11.2 12 17l-1.8-5.8L4.6 9.4l5.6-1.8L12 2z" />
      <path d="M19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15z" opacity="0.6" />
    </svg>
  );
}

interface ChatState {
  loaded: boolean;
  conversationId: string | null;
  messages: AiMessage[];
}

/**
 * The tenant admin's global AI assistant — a floating trigger + `Drawer` mounted once in
 * `(dashboard-shell)/layout.tsx` (available across the whole tenant app, not tucked into a
 * settings sub-page) and again on the standalone Forms Builder page
 * (`app/settings/forms/[formKey]/tenant-form-builder-client.tsx`, which renders outside the
 * dashboard shell entirely). Built entirely from `packages/ui` primitives (`Drawer`/`Toast`/
 * `Button`) plus this domain's own `ProposalCard` — no new design system.
 */
export function AiAssistantLauncher({ subdomain }: { subdomain: string }) {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<ChatState>({ loaded: false, conversationId: null, messages: [] });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const pageContext = useAiPageContext();
  
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || chat.loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listConversations(subdomain);
        const mostRecent = list.data[0];
        if (!mostRecent) {
          if (!cancelled) setChat({ loaded: true, conversationId: null, messages: [] });
          return;
        }
        const detail = await getConversation(mostRecent.id, subdomain);
        if (!cancelled) setChat({ loaded: true, conversationId: mostRecent.id, messages: detail.data.messages });
      } catch {
        // Resuming history is a nicety, not a requirement to open the drawer — fall back to a
        // fresh, empty conversation rather than blocking the assistant from opening at all.
        if (!cancelled) setChat({ loaded: true, conversationId: null, messages: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, chat.loaded, subdomain]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages, sending]);

  async function doSend(content: string) {
    setSending(true);
    setSendError(null);
    try {
      let conversationId = chat.conversationId;
      if (!conversationId) {
        const created = await createConversation(subdomain);
        conversationId = created.data.id;
      }
      const res = await sendMessage(conversationId, content, subdomain, pageContext.formKey ? { formKey: pageContext.formKey } : undefined);
      setChat((prev) => ({ loaded: true, conversationId: conversationId!, messages: [...prev.messages, res.data.message] }));
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Something went wrong sending that message.");
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    // Optimistic bubble — the server independently persists its own copy of this same message as
    // part of handling the request; nothing here is trusted as the record of truth.
    setChat((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        { id: `pending-${Date.now()}`, conversationId: prev.conversationId ?? "", role: "user", content, toolExecutionId: null, toolExecution: null, createdAt: new Date().toISOString() },
      ],
    }));
    void doSend(content);
  }

  function handleNewConversation() {
    setChat({ loaded: true, conversationId: null, messages: [] });
    setSendError(null);
  }

  async function handleConfirm(executionId: string) {
    setConfirmingId(executionId);
    try {
      const res = await confirmToolExecution(executionId, subdomain);
      applyExecutionUpdate(res.data);
      setToast({ message: res.data.status === "executed" ? "Change confirmed and applied." : `Confirmation failed: ${res.data.error}`, variant: res.data.status === "executed" ? "success" : "error" });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Couldn't confirm this action.", variant: "error" });
    } finally {
      setConfirmingId(null);
    }
  }

  async function handleReject(executionId: string) {
    setConfirmingId(executionId);
    try {
      const res = await rejectToolExecution(executionId, subdomain);
      applyExecutionUpdate(res.data);
      setToast({ message: "Change cancelled — nothing was modified.", variant: "success" });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Couldn't cancel this action.", variant: "error" });
    } finally {
      setConfirmingId(null);
    }
  }

  function applyExecutionUpdate(execution: { id: string; status: string; error?: string | null }) {
    setChat((prev) => ({
      ...prev,
      messages: prev.messages.map((m) => (m.toolExecution && m.toolExecution.id === execution.id ? { ...m, toolExecution: { ...m.toolExecution, ...execution } as AiMessage["toolExecution"] } : m)),
    }));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open AI assistant"
        className="fixed right-6 bottom-24 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-cta text-white shadow-card-lg transition hover:bg-cta-hover"
      >
        <SparkleIcon className="h-6 w-6" />
      </button>

      <Drawer open={open} onClose={() => setOpen(false)} title="AI Assistant">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <p className="text-xs text-slate-500">{pageContext.formKey ? `Viewing: ${pageContext.formKey} form` : "General assistant"}</p>
            <button type="button" className="text-xs font-medium text-cta hover:underline" onClick={handleNewConversation}>
              New conversation
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-4">
            {!chat.loaded && <p className="text-sm text-slate-400">Loading…</p>}
            {chat.loaded && chat.messages.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-slate-500">
                Ask me things like <span className="font-medium text-primary">&ldquo;What fields are on the member form?&rdquo;</span> or{" "}
                <span className="font-medium text-primary">&ldquo;Add an emergency contact name field.&rdquo;</span>
              </div>
            )}
            {chat.messages.map((message) => (
              <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={message.role === "user" ? "max-w-[85%]" : "w-full max-w-[92%]"}>
                  <div className={message.role === "user" ? "rounded-2xl rounded-br-sm bg-cta px-3.5 py-2 text-sm text-white" : "rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2 text-sm text-primary"}>
                    {message.role === "user" ? message.content : <MarkdownMessage content={message.content} />}
                  </div>
                  {message.toolExecution && (
                    <ProposalCard execution={message.toolExecution} onConfirm={handleConfirm} onReject={handleReject} busy={confirmingId === message.toolExecution.id} />
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-500">
                  <span className="btn-spinner" aria-hidden="true" />
                  Thinking…
                </div>
              </div>
            )}
            {sendError && (
              <div className="banner-error flex items-center justify-between gap-3 text-sm">
                <span>{sendError}</span>
                <Button variant="outline" size="sm" onClick={() => void doSend(chat.messages.at(-1)?.content ?? "")}>
                  Retry
                </Button>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border pt-3">
            <input
              className="field-input flex-1"
              placeholder="Ask the assistant…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
            />
            <Button type="submit" size="md" isLoading={sending} disabled={!input.trim()}>
              Send
            </Button>
          </form>
        </div>
      </Drawer>

      {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </>
  );
}
