/**
 * AI-Assisted Course Generation — turns an uploaded syllabus/document's raw bytes into plain text
 * the AI can read as source material. No existing text-extraction infrastructure was found anywhere
 * in this codebase (confirmed via audit — no `pdf-parse`/`mammoth`/OCR dependency, no extraction
 * module) — this is genuinely new, minimum-required infrastructure for the two textual formats the
 * "AI-Assisted Generation" modal already advertises (PDF, DOCX). Images are handled separately, as
 * multimodal AI input (`ai/provider/ai-provider.ts`'s `ChatMessage.images`) rather than text
 * extraction — see `course-generation-routes.ts`.
 *
 * The extracted text is treated as untrusted course SOURCE MATERIAL, never as instructions —
 * `course-generation-routes.ts` wraps it in a clearly delimited block in the prompt sent to the
 * model, with an explicit system-prompt instruction not to follow anything inside it as a command
 * (prompt-injection-from-document mitigation).
 */

const MAX_EXTRACTED_CHARS = 20_000;

export interface DocumentExtractionResult {
  text: string;
  /** True when the source document's text ran past `MAX_EXTRACTED_CHARS` and was cut off — surfaced
   * so the caller can tell the model (and, if ever shown, the user) the source was only partially
   * read, rather than silently generating from an incomplete document. */
  truncated: boolean;
}

export class DocumentExtractionError extends Error {}

function clip(text: string): DocumentExtractionResult {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EXTRACTED_CHARS) {
    return { text: trimmed, truncated: false };
  }
  return { text: trimmed.slice(0, MAX_EXTRACTED_CHARS), truncated: true };
}

async function extractPdfText(buffer: Buffer): Promise<DocumentExtractionResult> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    // Built from `pages` rather than `result.text` directly — the latter interleaves a
    // `-- N of M --` page-separator marker between pages, which is fine for a human reading a
    // rendered preview but is just noise for an LLM prompt.
    const text = result.pages.map((page) => page.text).join("\n\n");
    if (!text.trim()) {
      throw new DocumentExtractionError("That PDF doesn't seem to contain any readable text (it may be a scanned image).");
    }
    return clip(text);
  } catch (err) {
    if (err instanceof DocumentExtractionError) throw err;
    throw new DocumentExtractionError("Couldn't read that PDF. Try a different file, or describe the course in the prompt instead.");
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer): Promise<DocumentExtractionResult> {
  const mammoth = await import("mammoth");
  try {
    const result = await mammoth.extractRawText({ buffer });
    if (!result.value.trim()) {
      throw new DocumentExtractionError("That document doesn't seem to contain any readable text.");
    }
    return clip(result.value);
  } catch (err) {
    if (err instanceof DocumentExtractionError) throw err;
    throw new DocumentExtractionError("Couldn't read that document. Try a different file, or describe the course in the prompt instead.");
  }
}

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** `contentType` must already be allowlist-validated by the caller (`attachment-allowlist.ts`) — this
 * only decides which parser to run, never re-validates type/size itself. Legacy `.doc` (not `.docx`)
 * has no supported extraction path (`mammoth` only reads the modern OOXML format) — it fails here
 * with the same honest error a corrupt file would. */
export async function extractDocumentText(buffer: Buffer, contentType: string): Promise<DocumentExtractionResult> {
  if (contentType === "application/pdf") {
    return extractPdfText(buffer);
  }
  if (contentType === DOCX_CONTENT_TYPE) {
    return extractDocxText(buffer);
  }
  throw new DocumentExtractionError(`Documents of type "${contentType}" can't be read for text yet.`);
}
