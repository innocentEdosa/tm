"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, Heading2, Heading3, List, ListOrdered, Quote, Link as LinkIcon, Code } from "lucide-react";

export interface RichTextEditorProps {
  /** Initial HTML content. Uncontrolled by design (like every other rich-text editor) — to load a
   * different record, remount with a new `key` rather than pushing a new `defaultValue`. */
  defaultValue?: string;
  onChange: (html: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  id?: string;
  className?: string;
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`cursor-pointer rounded p-1.5 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? "bg-slate-200 text-primary" : "text-secondary"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Shared rich-text editor (Tiptap/ProseMirror) — Bold/Italic/Heading/Lists/Quote/Link/Code toolbar,
 * all from marks and nodes `@tiptap/starter-kit` already bundles (no extra dependencies), used by
 * every screen that picks up this component. Replaces the earlier textarea-plus-markdown-insert-
 * buttons approach. Image/embed support is intentionally left out — those would need a real
 * upload/storage story (or a data-URL hack), a bigger step than this toolbar pass.
 */
export function RichTextEditor({ defaultValue = "", onChange, placeholder, readOnly = false, id, className = "" }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder })],
    content: defaultValue,
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        id: id ?? "",
        class:
          "field-input min-h-[160px] rounded-t-none [&_p]:m-0 [&_ul]:my-0 [&_ol]:my-0 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-slate-100 [&_pre]:p-2 [&_pre]:text-sm [&_a]:text-cta [&_a]:underline",
      },
    },
  });

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  function toggleLink() {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("Link URL");
    if (!url) return;
    editor.chain().focus().setLink({ href: url }).run();
  }

  if (!editor) return null;

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1 rounded-t-lg border border-b-0 border-border bg-slate-50 px-2 py-1.5">
        <ToolbarButton label="Bold" active={editor.isActive("bold")} disabled={readOnly} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive("italic")} disabled={readOnly} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Heading 2" active={editor.isActive("heading", { level: 2 })} disabled={readOnly} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Heading 3" active={editor.isActive("heading", { level: 3 })} disabled={readOnly} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} disabled={readOnly} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Bulleted list" active={editor.isActive("bulletList")} disabled={readOnly} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Quote" active={editor.isActive("blockquote")} disabled={readOnly} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Link" active={editor.isActive("link")} disabled={readOnly} onClick={toggleLink}>
          <LinkIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Code block" active={editor.isActive("codeBlock")} disabled={readOnly} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <Code className="h-4 w-4" />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
