import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders an assistant message's Markdown (the model replies in Markdown — headings, bold, lists,
 * code — but the chat bubble used to dump `message.content` as a raw string, so it all rendered as
 * one unformatted run of text). Deliberately not `@tailwindcss/typography`'s `prose` classes — the
 * design-system lock (globals.css) doesn't use that plugin, so element styling is hand-mapped here
 * to match the existing bubble's `text-sm` sizing instead of pulling in prose's own font-size/color
 * defaults. User messages are left as plain text in the caller — only ever the user's own words
 * echoed back, nothing worth interpreting as Markdown.
 */
const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-cta underline">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs">{children}</code>,
  pre: ({ children }) => <pre className="mb-2 overflow-x-auto rounded bg-slate-800 p-2 font-mono text-xs text-slate-100 last:mb-0">{children}</pre>,
  h1: ({ children }) => <h1 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>,
};

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="[&_p]:leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
