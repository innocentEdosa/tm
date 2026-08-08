/**
 * Course/module/content-item descriptions are authored as HTML by `RichTextEditor`
 * (packages/ui/src/rich-text-editor.tsx, Tiptap `StarterKit`) — bold/italic/underline/strike,
 * H2/H3, ordered/unordered lists, blockquote, links, and code, nothing else (that toolbar is the
 * entire surface). Rendering that HTML for a learner (course marketplace browse/detail, "My
 * Courses") needs `dangerouslySetInnerHTML` to show the actual formatting rather than raw tags or a
 * stripped-to-plain-text preview — but every `description` field is plain `text` in Postgres with no
 * server-side validation that it only ever contains StarterKit's tag set (a route smart enough to
 * call `PATCH .../objectives` or `.../image` directly, bypassing the editor, could put anything in
 * `description`). This allowlist sanitizer is what makes rendering it safe: unknown tags are
 * unwrapped (content kept, tag dropped) rather than trusted, every attribute is dropped except
 * `href` on `<a>` (which is further checked against `javascript:`/`data:`/`vbscript:` schemes), and
 * script/style/iframe/object/embed/form/svg are removed entirely, content included. No new
 * dependency — `DOMParser` is a standard browser API, already relied on implicitly by every
 * `"use client"` component that uses one (Constitution Principle XII: prefer built-in utilities).
 */

const ALLOWED_TAGS = new Set(["P", "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "A", "CODE", "PRE", "BR"]);

const REMOVE_ENTIRELY = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "SVG"]);

const UNSAFE_URL_SCHEME = /^\s*(javascript|data|vbscript):/i;

function sanitizeChildren(el: Element): void {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const childEl = child as Element;

    // Recurse first so nested disallowed/dangerous content is already resolved before this level
    // decides whether to unwrap, remove, or keep `childEl` itself.
    sanitizeChildren(childEl);

    if (REMOVE_ENTIRELY.has(childEl.tagName)) {
      childEl.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(childEl.tagName)) {
      while (childEl.firstChild) el.insertBefore(childEl.firstChild, childEl);
      childEl.remove();
      continue;
    }

    for (const attr of Array.from(childEl.attributes)) {
      if (childEl.tagName === "A" && attr.name === "href") {
        if (UNSAFE_URL_SCHEME.test(attr.value)) childEl.removeAttribute("href");
        continue;
      }
      childEl.removeAttribute(attr.name);
    }
    if (childEl.tagName === "A" && childEl.hasAttribute("href")) {
      childEl.setAttribute("target", "_blank");
      childEl.setAttribute("rel", "noopener noreferrer");
    }
  }
}

/** Returns sanitized HTML safe to pass to `dangerouslySetInnerHTML`. Browser-only (`DOMParser`) —
 * returns the empty string during SSR, harmless since every call site here fetches its data
 * client-side and renders a loading state until then, so `description` is never populated yet on
 * the server-rendered pass anyway. */
export function sanitizeRichText(html: string): string {
  if (typeof window === "undefined" || !html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeChildren(doc.body);
  return doc.body.innerHTML;
}
